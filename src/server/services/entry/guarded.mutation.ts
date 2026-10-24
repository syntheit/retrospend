import { TRPCError } from "@trpc/server";
import type { MoneyMutation } from "../preview/types";

/**
 * An undo is only safe against the state its write left behind. This runs
 * `mutation` only while the expense still has the `updatedAt` the write
 * returned (checked in the mutation's own transaction, so a concurrent edit
 * cannot slip in between); otherwise it refuses with a conflict. Without an
 * expected stamp it is the mutation unchanged.
 */
export function unlessChanged<I extends { id: string }, V>(
	mutation: MoneyMutation<I, V>,
	expectedUpdatedAt: string | undefined,
): MoneyMutation<I, V> {
	if (!expectedUpdatedAt) return mutation;
	return {
		...mutation,
		run: async (tx, input, actor) => {
			const row = await tx.expense.findFirst({
				where: { id: input.id, userId: actor.userId },
				select: { updatedAt: true },
			});
			if (row && row.updatedAt.toISOString() !== expectedUpdatedAt)
				throw new TRPCError({
					code: "CONFLICT",
					message: "This expense changed since. Undo is no longer safe.",
				});
			return mutation.run(tx, input, actor);
		},
	};
}
