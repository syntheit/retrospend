/**
 * Drafts between the database and the services (SPEC §5.13): rows to DTOs
 * and the saved plan Use my plan starts from. JSON columns hold ids and
 * amounts only, parsed with the contract's own schemas.
 */
import { z } from "zod";
import {
	type DraftDto,
	draftMoveSchema,
	expectedInSchema,
	planLineSchema,
	pretendRowSchema,
} from "~/lib/schemas/envelope-plan";
import type { BudgetDraft, Prisma } from "~prisma";
import type { SavedPlanLine } from "./planning";
import type { MonthKey } from "./types";

type Tx = Prisma.TransactionClient;

export function toDraftDto(d: BudgetDraft): DraftDto {
	return {
		id: d.id,
		kind: d.kind,
		month: d.month,
		status: d.status,
		lines: z.array(planLineSchema).parse(d.lines),
		moves: z.array(draftMoveSchema).parse(d.moves),
		expectedIn: z.array(expectedInSchema).parse(d.expectedIn),
		pretend: z.array(pretendRowSchema).parse(d.pretend),
		appliedAt: d.appliedAt,
		fundedBatchId: d.fundedBatchId,
		updatedAt: d.updatedAt,
	};
}

/** The saved plan for `month` (status APPLIED), or null. */
export function savedPlan(tx: Tx, bookId: string, month: MonthKey) {
	return tx.budgetDraft.findFirst({
		where: { bookId, month, kind: "PLAN", status: "APPLIED" },
	});
}

/** The saved plan's lines Use my plan starts from (owner r5 Q1); none without one. */
export async function savedPlanLines(
	tx: Tx,
	bookId: string,
	month: MonthKey,
): Promise<SavedPlanLine[]> {
	const d = await savedPlan(tx, bookId, month);
	return d ? toDraftDto(d).lines : [];
}
