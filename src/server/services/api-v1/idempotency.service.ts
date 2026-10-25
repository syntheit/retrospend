import { createHash, createHmac } from "node:crypto";
import { IDEMPOTENCY_TTL_MS } from "@retrospend/api-contract/common";
import { env } from "~/env";
import { db, type db as globalDb } from "~/server/db";
import { Prisma } from "~prisma";

/** A user-scoped client (createUserScopedDb): RLS keeps keys per user. */
type UserDb = typeof globalDb;

/**
 * Largest response kept for replay (serialized JSON). A bigger one keeps
 * only the fact that the key was used, so a replay is
 * `idempotency_replay_unavailable` rather than an unbounded row.
 */
export const MAX_STORED_RESPONSE_BYTES = 64 * 1024;

const PRUNE_PROBABILITY = 0.01;

export type IdempotencyStart =
	| { kind: "started"; id: string }
	| { kind: "replay"; status: number; body: unknown }
	| { kind: "reused" }
	| { kind: "in_progress" }
	| { kind: "replay_unavailable" };

/** JSON with sorted object keys, so equal bodies hash equally. */
function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object") {
		const entries = Object.keys(value as Record<string, unknown>)
			.sort()
			.filter((k) => (value as Record<string, unknown>)[k] !== undefined)
			.map(
				(k) =>
					`${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`,
			);
		return `{${entries.join(",")}}`;
	}
	return JSON.stringify(value ?? null);
}

/**
 * Replaces every Blob or File, at any depth, with its name, type, size and
 * a hash of its bytes, and every Date with its ISO string. JSON sees a File
 * as `{}`, so without this two uploads with one key would look equal and
 * the second would replay the first response.
 */
async function describeFiles(value: unknown): Promise<unknown> {
	if (value instanceof Blob) {
		const bytes = new Uint8Array(await value.arrayBuffer());
		return {
			name: value instanceof File ? value.name : null,
			type: value.type,
			size: value.size,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		};
	}
	// JSON would also see a Date as `{}`.
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return Promise.all(value.map(describeFiles));
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) out[k] = await describeFiles(v);
		return out;
	}
	return value;
}

/**
 * Key for request fingerprints, derived from AUTH_SECRET so it is used for
 * nothing else. A keyed hash matters because inputs can hold secrets (the
 * current password on PATCH /profile): a plain sha256 of a short password
 * stored in the database could be brute-forced offline.
 */
let fingerprintKey: Buffer | undefined;
function getFingerprintKey() {
	fingerprintKey ??= createHmac("sha256", env.BETTER_AUTH_SECRET)
		.update("idempotency-fingerprint")
		.digest();
	return fingerprintKey;
}

/** Fingerprint of a request: the same key must come with the same request. */
export async function hashRequest(
	method: string,
	path: string,
	input: unknown,
): Promise<string> {
	const canonical = canonicalJson(await describeFiles(input));
	return createHmac("sha256", getFingerprintKey())
		.update(`${method.toUpperCase()} ${path}\n${canonical}`)
		.digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
	return (
		error instanceof Prisma.PrismaClientKnownRequestError &&
		error.code === "P2002"
	);
}

/**
 * Claims `key` for this user, or explains why the request must not run.
 * The insert is the lock: of two concurrent requests with one key, exactly
 * one creates the row and runs; the other sees it in progress or replays
 * it. An expired row is removed and the key claimed again.
 */
export async function startIdempotentRequest(
	userDb: UserDb,
	input: { userId: string; key: string; requestHash: string; now?: Date },
	attempt = 0,
): Promise<IdempotencyStart> {
	const now = input.now ?? new Date();
	if (attempt === 0 && Math.random() < PRUNE_PROBABILITY) {
		await pruneExpiredKeys(now).catch(() => undefined);
	}
	try {
		const row = await userDb.idempotencyKey.create({
			data: {
				userId: input.userId,
				key: input.key,
				requestHash: input.requestHash,
				expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
			},
			select: { id: true },
		});
		return { kind: "started", id: row.id };
	} catch (error) {
		if (!isUniqueViolation(error)) throw error;
	}

	const existing = await userDb.idempotencyKey.findUnique({
		where: { userId_key: { userId: input.userId, key: input.key } },
	});
	if (!existing || existing.expiresAt <= now) {
		if (attempt > 0) return { kind: "in_progress" };
		if (existing) {
			await userDb.idempotencyKey.deleteMany({
				where: { id: existing.id, expiresAt: { lte: now } },
			});
		}
		return startIdempotentRequest(userDb, input, attempt + 1);
	}
	if (existing.requestHash !== input.requestHash) return { kind: "reused" };
	if (!existing.completedAt || existing.status === null)
		return { kind: "in_progress" };
	if (existing.responseBody === null) return { kind: "replay_unavailable" };
	return {
		kind: "replay",
		status: existing.status,
		body: existing.responseBody,
	};
}

/**
 * Stores the first response. `body` undefined keeps only the fact that the
 * key was used (the response held a secret shown once).
 */
export async function completeIdempotentRequest(
	userDb: UserDb,
	id: string,
	status: number,
	body: unknown,
) {
	const json = body === undefined ? undefined : JSON.stringify(body);
	const keep =
		json !== undefined &&
		Buffer.byteLength(json, "utf8") <= MAX_STORED_RESPONSE_BYTES;
	// updateMany: deleting the account removes its own key row, and the delete
	// has committed by now, so a missing row is not an error.
	await userDb.idempotencyKey.updateMany({
		where: { id },
		data: {
			completedAt: new Date(),
			status,
			responseBody:
				keep && json !== undefined
					? (JSON.parse(json) as Prisma.InputJsonValue)
					: Prisma.DbNull,
		},
	});
}

/**
 * Deletes every user's expired keys through the owner connection (RLS would
 * limit the user-scoped client to the caller's rows, and a user who stops
 * writing would keep theirs forever). Runs now and then from
 * startIdempotentRequest; expired rows hold nothing anyone can replay.
 */
export async function pruneExpiredKeys(now: Date = new Date()) {
	const { count } = await db.idempotencyKey.deleteMany({
		where: { expiresAt: { lt: now } },
	});
	return count;
}

/** Frees the key after a failed request so the client can retry it. */
export async function releaseIdempotentRequest(userDb: UserDb, id: string) {
	await userDb.idempotencyKey.deleteMany({ where: { id } });
}
