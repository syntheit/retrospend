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

/**
 * The `updatedAt` of each of these rows, in id order, locked unless asked not
 * to; a row that is gone is missing from the answer.
 */
type ReadStamps = (
	tx: Tx,
	ids: readonly string[],
	userId: string,
	lock: boolean,
) => Promise<Map<string, Date>>;

/**
 * The one compare of an undo's stamps with what the rows have now. A preview
 * skips the lock: it writes nothing, and its snapshot read would fail on a
 * row changed since. FOR UPDATE makes the compare a compare-and-swap: a second
 * writer holding the same stamp waits here for the first to commit, then reads
 * the row it left and is refused. A row that is gone passes through, so the
 * mutation's own not-found answer stands. By instant, so an offset spelling of
 * the same time is not stale. One stale row refuses all of them.
 */
async function requireStamps(
	tx: Tx,
	readStamps: ReadStamps,
	userId: string,
	expected: ReadonlyMap<string, string>,
	stale: () => Error,
) {
	const current = await readStamps(
		tx,
		[...expected.keys()],
		userId,
		!inPreview(),
	);
	for (const [id, stamp] of expected) {
		const now = current.get(id);
		if (now && now.getTime() !== Date.parse(stamp)) throw stale();
	}
}

/**
 * An undo is only safe against the state its write left behind, so a write
 * hands back the `updatedAt` it left (read in its own transaction, null when
 * the row is gone), and an undo that names the stamp it expects runs only
 * while the row still has it (`requireStamps`, in the mutation's transaction
 * on the locked row, so a concurrent edit cannot slip in between). This is the
 * one owner of that rule; each table only says how to read its stamps.
 */
function guarded<I extends object, V extends { id: string }>(
	mutation: MoneyMutation<I, V>,
	readStamps: ReadStamps,
	expectedUpdatedAt: string | undefined,
	stale: () => Error,
): MoneyMutation<I, V & { updatedAt: string | null }> {
	return {
		...mutation,
		run: async (tx, input, actor) => {
			const id = (input as { id?: string }).id;
			if (expectedUpdatedAt && id)
				await requireStamps(
					tx,
					readStamps,
					actor.userId,
					new Map([[id, expectedUpdatedAt]]),
					stale,
				);
			const done = await mutation.run(tx, input, actor);
			const after = (
				await readStamps(tx, [done.value.id], actor.userId, false)
			).get(done.value.id);
			return {
				value: { ...done.value, updatedAt: after?.toISOString() ?? null },
				undo: done.undo,
			};
		},
	};
}

/** Expense rows' stamps; the ids are sorted so two writers lock in one order. */
export const readExpenseStamps: ReadStamps = async (tx, ids, userId, lock) => {
	const rows = await tx.$queryRaw<{ id: string; updatedAt: Date }[]>`
		SELECT "id", "updatedAt" FROM "expense"
		WHERE "id" = ANY(${[...ids]}) AND "userId" = ${userId}
		ORDER BY "id"
		${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
	return new Map(rows.map((r) => [r.id, r.updatedAt]));
};

// A shared row is read through the caller's access, not a userId column.
const readSharedStamps: ReadStamps = async (tx, ids, _userId, lock) => {
	const rows = await tx.$queryRaw<{ id: string; updatedAt: Date }[]>`
		SELECT "id", "updatedAt" FROM "shared_transaction"
		WHERE "id" = ANY(${[...ids]})
		ORDER BY "id"
		${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
	return new Map(rows.map((r) => [r.id, r.updatedAt]));
};

/**
 * Refuses unless each of these expense rows still has the `updatedAt` its
 * write left (the bulk undo's guard; `guardedExpense` is the single-row one).
 */
export const requireExpenseStamps = (
	tx: Tx,
	userId: string,
	expected: ReadonlyMap<string, string>,
	stale: () => Error = undoNoLongerSafe,
) => requireStamps(tx, readExpenseStamps, userId, expected, stale);

/** `stale` builds the refusal for a caller that is not an undo. */
export function guardedExpense<I extends object, V extends { id: string }>(
	mutation: MoneyMutation<I, V>,
	expectedUpdatedAt?: string,
	stale: () => Error = undoNoLongerSafe,
): MoneyMutation<I, V & { updatedAt: string | null }> {
	return guarded(mutation, readExpenseStamps, expectedUpdatedAt, stale);
}

/** The same for a shared expense, which moves other people's balances too. */
export function guardedShared<I extends object, V extends { id: string }>(
	mutation: MoneyMutation<I, V>,
	expectedUpdatedAt?: string,
	stale: () => Error = undoNoLongerSafe,
): MoneyMutation<I, V & { updatedAt: string | null }> {
	return guarded(mutation, readSharedStamps, expectedUpdatedAt, stale);
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

const undoAnswered = () =>
	new TRPCError({
		code: "CONFLICT",
		message:
			"Someone already answered this expense, so this edit cannot be undone.",
	});

/** Each other person's share status on `id`, keyed by who they are. */
async function shareStatuses(tx: Tx, id: string, userId: string) {
	const rows = await tx.splitParticipant.findMany({
		where: {
			transactionId: id,
			NOT: { participantType: "user", participantId: userId },
		},
		select: {
			participantType: true,
			participantId: true,
			verificationStatus: true,
		},
	});
	return new Map(
		rows.map((r) => [
			`${r.participantType}:${r.participantId}`,
			r.verificationStatus,
		]),
	);
}

/**
 * The edit an undo of a shared edit runs, for the web and for v1's undo and
 * redo tokens (one core, so the rule is written once). It is refused when the
 * write would take back an answer someone gave (accepted or rejected): an
 * answer writes the share, not the row, so the stamp cannot see it. Which
 * edits reset answers is the split service's own rule (amount, currency, date,
 * payer, project, split), so this asks the write what it did instead of
 * copying that list; a text-only undo leaves every answer and passes. Anyone
 * who answered before this edit counts too, not only answers since it, which
 * errs on the side of not overwriting what people agreed to. The refusal
 * throws inside the transaction, so nothing is written and the queued notices
 * are never sent.
 */
export const updateSharedUnanswered: MoneyMutation<
	UpdateSharedInput & Deferred,
	UpdatedShared
> = {
	...updateSharedExpense,
	run: async (tx, input, actor) => {
		const before = await shareStatuses(tx, input.id, actor.userId);
		const done = await updateSharedExpense.run(tx, input, actor);
		const answered = [...before].filter(
			([, status]) => status === "ACCEPTED" || status === "REJECTED",
		);
		if (answered.length > 0) {
			const after = await shareStatuses(tx, input.id, actor.userId);
			if (answered.some(([who, status]) => after.get(who) !== status))
				throw undoAnswered();
		}
		return done;
	},
};

/**
 * The web's undo of a shared edit: the edit's old values, written (and the
 * people on it told) only while the row still has the `updatedAt` that edit
 * left and it takes back no answer (`updateSharedUnanswered`). Required in
 * the input, so the preview twin refuses a stale undo too.
 */
export const revertSharedExpense: MoneyMutation<
	UpdateSharedInput & Deferred & { expectedUpdatedAt: string },
	UpdatedShared & { updatedAt: string | null }
> = {
	id: updateSharedExpense.id,
	touches: updateSharedExpense.touches,
	run: (tx, { expectedUpdatedAt, ...input }, actor) =>
		guardedShared(updateSharedUnanswered, expectedUpdatedAt).run(
			tx,
			input,
			actor,
		),
};
