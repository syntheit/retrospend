import { TRPCError } from "@trpc/server";
import { inPreview } from "~/server/db-tx";
import { Prisma } from "~prisma";
import type { MoneyMutation } from "../preview/types";
import {
	type UpdateExpenseInput,
	updateExpenseEntry,
} from "./expense.mutation";
import {
	type Deferred,
	type UpdatedShared,
	type UpdateSharedInput,
	updateSharedExpense,
} from "./shared.mutation";

const undoNoLongerSafe = () =>
	new TRPCError({
		code: "CONFLICT",
		message: "This expense changed since. Undo is no longer safe.",
	});

type Tx = Prisma.TransactionClient;

/** The row's `updatedAt`, locked unless asked not to; undefined when it is gone. */
type ReadStamp = (
	tx: Tx,
	id: string,
	userId: string,
	lock: boolean,
) => Promise<Date | undefined>;

/**
 * An undo is only safe against the state its write left behind, so a write
 * hands back the `updatedAt` it left (read in its own transaction, null when
 * the row is gone), and an undo that names the stamp it expects runs only
 * while the row still has it. The check is made in the mutation's transaction
 * on the locked row, so a concurrent edit cannot slip in between (a preview
 * skips the lock: it writes nothing, and its snapshot read would fail on a
 * row changed since). A row that is gone passes through, so the mutation's
 * own not-found answer stands. This is the one owner of that rule; each table
 * only says how to read its stamp.
 */
function guarded<I extends object, V extends { id: string }>(
	mutation: MoneyMutation<I, V>,
	readStamp: ReadStamp,
	expectedUpdatedAt: string | undefined,
	stale: () => Error,
): MoneyMutation<I, V & { updatedAt: string | null }> {
	return {
		...mutation,
		run: async (tx, input, actor) => {
			const id = (input as { id?: string }).id;
			if (expectedUpdatedAt && id) {
				// FOR UPDATE makes the compare a compare-and-swap: a second writer
				// holding the same stamp waits here for the first to commit, then
				// reads the row it left and is refused. A gone row returns nothing.
				const current = await readStamp(tx, id, actor.userId, !inPreview());
				// By instant, so an offset spelling of the same time is not stale.
				if (current && current.getTime() !== Date.parse(expectedUpdatedAt))
					throw stale();
			}
			const done = await mutation.run(tx, input, actor);
			const after = await readStamp(tx, done.value.id, actor.userId, false);
			return {
				value: { ...done.value, updatedAt: after?.toISOString() ?? null },
				undo: done.undo,
			};
		},
	};
}

const expenseStamp: ReadStamp = async (tx, id, userId, lock) => {
	const [row] = await tx.$queryRaw<{ updatedAt: Date }[]>`
		SELECT "updatedAt" FROM "expense"
		WHERE "id" = ${id} AND "userId" = ${userId}
		${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
	return row?.updatedAt;
};

// A shared row is read through the caller's access, not a userId column.
const sharedStamp: ReadStamp = async (tx, id, _userId, lock) => {
	const [row] = await tx.$queryRaw<{ updatedAt: Date }[]>`
		SELECT "updatedAt" FROM "shared_transaction"
		WHERE "id" = ${id}
		${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
	return row?.updatedAt;
};

/** `stale` builds the refusal for a caller that is not an undo. */
export function guardedExpense<I extends object, V extends { id: string }>(
	mutation: MoneyMutation<I, V>,
	expectedUpdatedAt?: string,
	stale: () => Error = undoNoLongerSafe,
): MoneyMutation<I, V & { updatedAt: string | null }> {
	return guarded(mutation, expenseStamp, expectedUpdatedAt, stale);
}

/** The same for a shared expense, which moves other people's balances too. */
export function guardedShared<I extends object, V extends { id: string }>(
	mutation: MoneyMutation<I, V>,
	expectedUpdatedAt?: string,
	stale: () => Error = undoNoLongerSafe,
): MoneyMutation<I, V & { updatedAt: string | null }> {
	return guarded(mutation, sharedStamp, expectedUpdatedAt, stale);
}

/**
 * The web's undo of an edit: the edit's old values, written only while the
 * row still has the `updatedAt` that edit left. The stamp rides in the input
 * (required), so the preview twin refuses a stale undo the same way.
 */
export const revertExpenseEntry: MoneyMutation<
	UpdateExpenseInput & { expectedUpdatedAt: string },
	{ id: string; updatedAt: string | null }
> = {
	id: updateExpenseEntry.id,
	touches: updateExpenseEntry.touches,
	run: (tx, { expectedUpdatedAt, ...input }, actor) =>
		guardedExpense(updateExpenseEntry, expectedUpdatedAt).run(tx, input, actor),
};

/**
 * The web's undo of a shared edit: the edit's old values, written (and the
 * people on it told) only while the row still has the `updatedAt` that edit
 * left. Required in the input, so the preview twin refuses a stale undo too.
 */
export const revertSharedExpense: MoneyMutation<
	UpdateSharedInput & Deferred & { expectedUpdatedAt: string },
	UpdatedShared & { updatedAt: string | null }
> = {
	id: updateSharedExpense.id,
	touches: updateSharedExpense.touches,
	run: (tx, { expectedUpdatedAt, ...input }, actor) =>
		guardedShared(updateSharedExpense, expectedUpdatedAt).run(tx, input, actor),
};
