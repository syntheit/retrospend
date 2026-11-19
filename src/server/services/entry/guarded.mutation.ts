import { TRPCError } from "@trpc/server";
import { inPreview } from "~/server/db-tx";
import { Prisma } from "~prisma";
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
 * mutation's transaction on the locked row, so a concurrent edit cannot slip in
 * between (a preview skips the lock: it writes nothing, and its snapshot read
 * would fail on a row changed since). A row that is gone passes through, so
 * the mutation's own not-found answer stands.
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
				// FOR UPDATE makes the compare a compare-and-swap: a second writer
				// holding the same stamp waits here for the first to commit, then
				// reads the row it left and is refused. A gone row returns nothing.
				const [row] = await tx.$queryRaw<{ updatedAt: Date }[]>`
					SELECT "updatedAt" FROM "expense"
					WHERE "id" = ${id} AND "userId" = ${actor.userId}
					${inPreview() ? Prisma.empty : Prisma.sql`FOR UPDATE`}`;
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
