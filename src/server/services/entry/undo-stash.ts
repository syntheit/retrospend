/**
 * What an undo puts back, kept on the server. A delete whose rows do not fit
 * in a token (a set of expenses, a split with its shares, an account with its
 * history) writes them in the same transaction into the caller's own expiring
 * idempotency_key rows and hands out the stash id. The undo token carries only
 * that id, so it stays small, a lost response can be replayed, and only the
 * person who deleted can take the rows out: the key is scoped to their user,
 * and each stash is taken once.
 */
import { randomUUID } from "node:crypto";
import { IDEMPOTENCY_TTL_MS } from "@retrospend/api-contract/common";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";

type Tx = Prisma.TransactionClient;

/** The stash's key: no client key has this shape unless it copies one of its own. */
const stashKey = (stash: string) => `undo-stash:${stash}`;

const STASH_HASH = "undo-stash";

export const invalidUndo = () =>
	new TRPCError({
		code: "BAD_REQUEST",
		message: "This undo is not valid anymore",
	});

/** Keeps `body` for as long as an undo token lives (24 hours). Returns the stash id. */
export async function putUndoStash(
	tx: Tx,
	userId: string,
	body: unknown,
): Promise<string> {
	const stash = randomUUID();
	const now = new Date();
	await tx.idempotencyKey.create({
		data: {
			userId,
			key: stashKey(stash),
			requestHash: STASH_HASH,
			completedAt: now,
			status: 200,
			responseBody: JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue,
			expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
		},
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
	if (!row.responseBody) throw invalidUndo();
	return row.responseBody as T;
}
