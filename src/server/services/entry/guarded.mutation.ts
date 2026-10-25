import { TRPCError } from "@trpc/server";
import type { MoneyMutation } from "../preview/types";

/**
 * An undo is only safe against the state its write left behind, so an
 * expense write hands back the `updatedAt` it left (read in its own
 * transaction, null when the row is gone), and an undo that names the stamp
 * it expects runs only while the row still has it. The check is made in the
 * mutation's transaction, so a concurrent edit cannot slip in between.
 */
export function guardedExpense<I extends object, V extends { id: string }>(
	mutation: MoneyMutation<I, V>,
	expectedUpdatedAt?: string,
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
				if (row && row.updatedAt.toISOString() !== expectedUpdatedAt)
					throw new TRPCError({
						code: "CONFLICT",
						message: "This expense changed since. Undo is no longer safe.",
					});
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
