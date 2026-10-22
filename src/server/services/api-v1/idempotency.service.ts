import { createHash } from "node:crypto";
import { IDEMPOTENCY_TTL_MS } from "@retrospend/api-contract/common";
import type { db as globalDb } from "~/server/db";
import { Prisma } from "~prisma";

/** A user-scoped client (createUserScopedDb): RLS keeps keys per user. */
type UserDb = typeof globalDb;

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

/** Fingerprint of a request: the same key must come with the same request. */
export function hashRequest(method: string, path: string, input: unknown) {
	return createHash("sha256")
		.update(`${method.toUpperCase()} ${path}\n${canonicalJson(input)}`)
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
	await userDb.idempotencyKey.update({
		where: { id },
		data: {
			completedAt: new Date(),
			status,
			responseBody:
				body === undefined
					? Prisma.DbNull
					: (JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue),
		},
	});
}

/** Frees the key after a failed request so the client can retry it. */
export async function releaseIdempotentRequest(userDb: UserDb, id: string) {
	await userDb.idempotencyKey.deleteMany({ where: { id } });
}
