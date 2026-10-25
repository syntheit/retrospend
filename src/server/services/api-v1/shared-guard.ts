import { TRPCError } from "@trpc/server";
import type { MoneyMutation } from "~/server/services/preview/types";

/**
 * An undo is only safe against the state its write left behind (the same rule
 * as entry/guarded.mutation.ts for personal expenses). A shared-expense write
 * hands back the `updatedAt` it left (read in its own transaction, null when
 * the row is gone), and an undo that names the stamp it expects runs only
 * while the row still has it. The check is in the mutation's transaction, so
 * a concurrent edit cannot slip in between. Other people's balances move with
 * the row, so a stale undo must never restore old values over a newer edit.
 */
export function guardedShared<I extends object, V extends { id: string }>(
	mutation: MoneyMutation<I, V>,
	expectedUpdatedAt?: string,
): MoneyMutation<I, V & { updatedAt: string | null }> {
	return {
		...mutation,
		run: async (tx, input, actor) => {
			const id = (input as { id?: string }).id;
			if (expectedUpdatedAt && id) {
				const row = await tx.sharedTransaction.findUnique({
					where: { id },
					select: { updatedAt: true },
				});
				if (row && row.updatedAt.toISOString() !== expectedUpdatedAt)
					throw new TRPCError({
						code: "CONFLICT",
						message: "This expense changed since. Undo is no longer safe.",
					});
			}
			const done = await mutation.run(tx, input, actor);
			const after = await tx.sharedTransaction.findUnique({
				where: { id: done.value.id },
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
