import { TRPCError } from "@trpc/server";
import type { MoneyMutation } from "../preview/types";

const undoNoLongerSafe = () =>
	new TRPCError({
		code: "CONFLICT",
		message: "This expense changed since. Undo is no longer safe.",
	});

/**
 * An undo is only safe against the state its write left behind, so an
 * expense write hands back the `updatedAt` it left (read in its own
 * transaction, null when the row is gone), and an undo that names the stamp
 * it expects runs only while the row still has it. The check is made in the
 * mutation's transaction, so a concurrent edit cannot slip in between. A row
 * that is gone passes through, so the mutation's own not-found answer stands.
 * `stale` builds the refusal for a caller that is not an undo.
 */
export function guardedExpense<I extends object, V extends { id: string }>(
	mutation: MoneyMutation<I, V>,
	expectedUpdatedAt?: string,
	stale: () => Error = undoNoLongerSafe,
): MoneyMutation<I, V & { updatedAt: string | null }> {
	return {
		...mutation,
		run: async (tx, input, actor) => {
			const id = (input as { id?: string }).id;
			if (expectedUpdatedAt && id) {
				const row = await tx.expense.findFirst({
					where: { id, userId: actor.userId },
					select: { updatedAt: true },
				});
				// By instant, so an offset spelling of the same time is not stale.
				if (row && row.updatedAt.getTime() !== Date.parse(expectedUpdatedAt))
					throw stale();
			}
			const done = await mutation.run(tx, input, actor);
			const after = await tx.expense.findFirst({
				where: { id: done.value.id, userId: actor.userId },
				select: { updatedAt: true },
			});
			return {
				value: {
					...done.value,
					updatedAt: after?.updatedAt.toISOString() ?? null,
				},
				undo: done.undo,
			};
		},
	};
}
