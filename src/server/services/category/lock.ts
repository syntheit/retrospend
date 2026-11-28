/**
 * The category row, locked for the rest of the transaction: no row can be
 * filed under it, taken from it, renamed or deleted by another writer until
 * this transaction ends. The one lock every category mutation takes (merge,
 * the edit, the undo of a create) before it reads or counts anything.
 */
import { TRPCError } from "@trpc/server";
import type { Prisma } from "~prisma";
import { ownCategoryWhere } from "./own";

export const categoryNotFound = () =>
	new TRPCError({ code: "NOT_FOUND", message: "Category not found" });

/** The owner's row, `FOR UPDATE`; not the caller's or not there is "not found". */
export async function lockedCategory(
	tx: Prisma.TransactionClient,
	userId: string,
	id: string,
) {
	const [row] = await tx.$queryRaw<{ id: string }[]>`
		SELECT "id" FROM "category" WHERE "id" = ${id} AND "userId" = ${userId} FOR UPDATE`;
	if (!row) throw categoryNotFound();
	return tx.category.findFirstOrThrow({ where: ownCategoryWhere(userId, id) });
}
