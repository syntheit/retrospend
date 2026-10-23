/**
 * Who added a shared expense, for its read view ("Martín added this. Only
 * Martín can edit it."). Read through the user-scoped client, so a person
 * not on the expense gets NOT_FOUND like everywhere else.
 */
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "~prisma";
import { ExpenseService } from "../expense.service";
import { expenseDto, listHomeCurrency } from "../expense-dto";
import { resolveParticipantNames } from "../project/identities";

/** A personal expense for the edit sheet, as expense.getExpense sends it, by any id. */
export async function expenseForEdit(
	db: PrismaClient,
	userId: string,
	id: string,
) {
	const expense = await new ExpenseService(db).getExpense(userId, id);
	if (!expense) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
	}
	return expenseDto(expense, await listHomeCurrency(db, userId));
}

export interface SharedAuthor {
	readonly participantType: string;
	readonly participantId: string;
	readonly name: string;
	readonly avatarUrl: string | null;
	/** You added it. */
	readonly you: boolean;
}

export async function sharedAuthor(
	db: PrismaClient,
	userId: string,
	id: string,
): Promise<SharedAuthor> {
	const row = await db.sharedTransaction.findUnique({
		where: { id },
		select: { createdByType: true, createdById: true },
	});
	if (!row) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
	}
	const [author] = await resolveParticipantNames(db, [
		{ participantType: row.createdByType, participantId: row.createdById },
	]);
	return {
		participantType: row.createdByType,
		participantId: row.createdById,
		name: author?.name ?? "",
		avatarUrl: author?.avatarUrl ?? null,
		you: row.createdByType === "user" && row.createdById === userId,
	};
}
