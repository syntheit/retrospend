/**
 * Deleting several personal expenses as one money mutation (R30, R15): the
 * preview is one dry run of the whole set, so its "after" figures are exact,
 * and one undo puts every row back.
 *
 * - expense.deleteMany: each id goes as expense.delete takes it (the row and
 *   its spread parts). An id that is not yours or is gone is skipped, and so
 *   is a transfer's fee (it goes with its transfer). Refused when nothing can
 *   go. `expected` (a redo) runs only while each row still has the stamp the
 *   undo left.
 * - expense.restoreMany: the undo, every row back in one transaction; a row
 *   that is back already refuses the whole undo.
 *
 * The rows the undo puts back stay on the server (a stash in the caller's
 * own expiring idempotency_key rows, written in the delete's transaction), so
 * the undo token and the response stay small whatever the set holds, and a
 * lost response can always be replayed.
 */
import { randomUUID } from "node:crypto";
import { IDEMPOTENCY_TTL_MS } from "@retrospend/api-contract/common";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";
import { ExpenseService } from "../expense.service";
import type { MoneyMutation } from "../preview/types";
import { EXPENSE_FIGURES } from "./expense.mutation";
import {
	type ExpenseSnapshot,
	restoreExpense,
	snapshotExpense,
} from "./expense-snapshot";

type Tx = Prisma.TransactionClient;

export interface DeleteManyInput {
	readonly ids: readonly string[];
	/** id to the updatedAt it must still have; set by a redo. */
	readonly expected?: Readonly<Record<string, string>>;
}

export interface DeletedMany {
	readonly ids: readonly string[];
	readonly skipped: readonly string[];
	/** expense.restoreMany with this stash brings every deleted row back. */
	readonly stash: string;
}

/** The stash's key: no client key has this shape unless it copies one of its own. */
const stashKey = (stash: string) => `undo-stash:${stash}`;

const invalidUndo = () =>
	new TRPCError({
		code: "BAD_REQUEST",
		message: "This undo is not valid anymore",
	});

const stale = () =>
	new TRPCError({
		code: "CONFLICT",
		message: "This expense changed since. Undo is no longer safe.",
	});

/** Keeps the rows for as long as an undo token lives (24 hours). */
async function putStash(
	tx: Tx,
	userId: string,
	snapshots: ExpenseSnapshot[],
): Promise<string> {
	const stash = randomUUID();
	const now = new Date();
	await tx.idempotencyKey.create({
		data: {
			userId,
			key: stashKey(stash),
			requestHash: "undo-stash",
			completedAt: now,
			status: 200,
			responseBody: JSON.parse(
				JSON.stringify({ snapshots }),
			) as Prisma.InputJsonValue,
			expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
		},
	});
	return stash;
}

/** Takes the rows out of the stash; the undo's transaction removes it. */
async function takeStash(
	tx: Tx,
	userId: string,
	stash: string,
): Promise<ExpenseSnapshot[]> {
	const row = await tx.idempotencyKey.findUnique({
		where: { userId_key: { userId, key: stashKey(stash) } },
	});
	if (!row || row.expiresAt <= new Date()) throw invalidUndo();
	await tx.idempotencyKey.delete({ where: { id: row.id } });
	const body = row.responseBody as { snapshots?: ExpenseSnapshot[] } | null;
	if (!body?.snapshots?.length) throw invalidUndo();
	return body.snapshots;
}

export const deleteExpensesBulk: MoneyMutation<DeleteManyInput, DeletedMany> = {
	id: "expense.deleteMany",
	touches: EXPENSE_FIGURES,
	run: async (tx, input, actor) => {
		const ids = [...new Set(input.ids)];
		const rows = await tx.expense.findMany({
			where: {
				id: { in: ids },
				userId: actor.userId,
				direction: "OUT",
				isAmortizedChild: false,
			},
			select: {
				id: true,
				updatedAt: true,
				_count: { select: { accountLegs: true } },
			},
		});
		const byId = new Map(rows.map((r) => [r.id, r]));
		const service = new ExpenseService(tx);
		const deleted: string[] = [];
		const skipped: string[] = [];
		const snapshots: ExpenseSnapshot[] = [];
		for (const id of ids) {
			const row = byId.get(id);
			const want = input.expected?.[id];
			if (want && row && row.updatedAt.toISOString() !== want) throw stale();
			if (!row || row._count.accountLegs > 0) {
				skipped.push(id);
				continue;
			}
			snapshots.push(await snapshotExpense(tx, actor.userId, id));
			await service.deleteExpense(actor.userId, id);
			deleted.push(id);
		}
		if (deleted.length === 0) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "None of these expenses can be deleted here.",
			});
		}
		const stash = await putStash(tx, actor.userId, snapshots);
		return {
			value: { ids: deleted, skipped, stash },
			undo: {
				kind: "revert",
				mutation: "expense.restoreMany",
				rows: deleted.map((id) => ({ table: "expense", id })),
			},
		};
	},
};

export interface RestoredMany {
	readonly ids: readonly string[];
	/** id to the updatedAt the restore left, for the redo's check. */
	readonly stamps: Readonly<Record<string, string>>;
}

/** The undo of expense.deleteMany: the stashed rows back as they were stored. */
export const restoreExpensesBulk: MoneyMutation<
	{ stash: string },
	RestoredMany
> = {
	id: "expense.restoreMany",
	touches: EXPENSE_FIGURES,
	run: async (tx, input, actor) => {
		const snapshots = await takeStash(tx, actor.userId, input.stash);
		const ids: string[] = [];
		for (const snapshot of snapshots) {
			ids.push(await restoreExpense(tx, actor.userId, snapshot));
		}
		const rows = await tx.expense.findMany({
			where: { id: { in: ids }, userId: actor.userId },
			select: { id: true, updatedAt: true },
		});
		return {
			value: {
				ids,
				stamps: Object.fromEntries(
					rows.map((r) => [r.id, r.updatedAt.toISOString()]),
				),
			},
			undo: {
				kind: "revert",
				mutation: "expense.deleteMany",
				rows: ids.map((id) => ({ table: "expense", id })),
			},
		};
	},
};
