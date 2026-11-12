/**
 * What an undo puts back, kept on the server. A delete whose rows do not fit
 * in a token (a set of expenses, a split with its shares, an account with its
 * history) writes them in the same transaction into the caller's own expiring
 * idempotency_key rows and hands out the stash id. The undo token carries only
 * that id, so it stays small, a lost response can be replayed, and only the
 * person who deleted can take the rows out: the key is scoped to their user,
 * and each stash is taken once.
 *
 * The body is sealed with the owner's key (E2EE D11 PR 8.1), so code without
 * it (the expiry prune, account deletion) cannot read which uploaded files a
 * stash keeps. Each file gets a row of its own instead, with no body: key
 * `undo-icon:<stash>:<path>` (the path is a server-made name), same expiry,
 * taken with the stash.
 */
import { randomUUID } from "node:crypto";
import {
	IDEMPOTENCY_TTL_MS,
	SERVER_KEY_PREFIX,
} from "@retrospend/api-contract/common";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";

type Tx = Prisma.TransactionClient;

/** The stash's key: a client key may not start with a server prefix. */
const stashKey = (stash: string) => `${SERVER_KEY_PREFIX.undoStash}${stash}`;

const STASH_HASH = "undo-stash";

/** Marks a kept file's row: a client row's requestHash is a 64 hex digest. */
const UNDO_FILE_HASH = "undo-icon";

const fileKey = (stash: string, path = "") =>
	`${SERVER_KEY_PREFIX.undoIcon}${stash}:${path}`;

const FILE_KEY = new RegExp(
	`^${SERVER_KEY_PREFIX.undoIcon}[0-9a-f-]{36}:(.+)$`,
);

/**
 * The files kept by the stash rows `where` names (the expiry prune, account
 * deletion). Only rows this module wrote: the marker and the key's shape.
 */
export async function keptUndoFiles(
	db: Pick<Tx, "idempotencyKey">,
	where: Prisma.IdempotencyKeyWhereInput,
): Promise<string[]> {
	const rows = await db.idempotencyKey.findMany({
		where: {
			...where,
			key: { startsWith: SERVER_KEY_PREFIX.undoIcon },
			requestHash: UNDO_FILE_HASH,
		},
		select: { key: true },
	});
	return rows.flatMap((row) => FILE_KEY.exec(row.key)?.[1] ?? []);
}

export const invalidUndo = () =>
	new TRPCError({
		code: "BAD_REQUEST",
		message: "This undo is not valid anymore",
	});

/**
 * Keeps `body` for as long as an undo token lives (24 hours), and the
 * uploaded `files` it needs until then. Returns the stash id.
 */
export async function putUndoStash(
	tx: Tx,
	userId: string,
	body: unknown,
	files: readonly string[] = [],
): Promise<string> {
	const stash = randomUUID();
	const now = new Date();
	const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS);
	await tx.idempotencyKey.create({
		data: {
			userId,
			key: stashKey(stash),
			requestHash: STASH_HASH,
			completedAt: now,
			status: 200,
			responseBody: JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue,
			expiresAt,
		},
	});
	if (files.length > 0)
		await tx.idempotencyKey.createMany({
			data: files.map((path) => ({
				userId,
				key: fileKey(stash, path),
				requestHash: UNDO_FILE_HASH,
				expiresAt,
			})),
		});
	return stash;
}

/** Takes the body out of the stash; the undo's transaction removes it. */
export async function takeUndoStash<T>(
	tx: Tx,
	userId: string,
	stash: string,
): Promise<T> {
	const row = await tx.idempotencyKey.findUnique({
		where: { userId_key: { userId, key: stashKey(stash) } },
	});
	// Only a stash this module wrote: a client key can never be taken as one.
	if (!row || row.requestHash !== STASH_HASH || row.expiresAt <= new Date())
		throw invalidUndo();
	await tx.idempotencyKey.delete({ where: { id: row.id } });
	// The files are in use again once the rows come back.
	await tx.idempotencyKey.deleteMany({
		where: {
			userId,
			key: { startsWith: fileKey(stash) },
			requestHash: UNDO_FILE_HASH,
		},
	});
	if (!row.responseBody) throw invalidUndo();
	return row.responseBody as T;
}
