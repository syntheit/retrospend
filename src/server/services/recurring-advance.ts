/**
 * The write half of confirming or skipping a recurring period: the template
 * moves to its next due date with a compare-and-set, so two clients racing
 * for one period book it once. When the caller named the template version it
 * saw, the compare includes it: an edit that commits between the plan's read
 * and this write (the plan reads without a lock, at READ COMMITTED) matches no
 * row, so nothing is booked from the old template. What a lost compare means
 * is decided by the domain's `lostAdvance`.
 */
import type { SkipPlan } from "@retrospend/domain/recurring-post/plan";
import { lostAdvance } from "@retrospend/domain/recurring-post/plan";
import type { Prisma } from "~prisma";

export async function advanceTemplate(
	tx: Prisma.TransactionClient,
	userId: string,
	plan: SkipPlan,
	expectedUpdatedAt: Date | null | undefined,
	call: "confirm" | "skip",
): Promise<void> {
	const advanced = await tx.recurringTemplate.updateMany({
		where: {
			id: plan.templateId,
			userId,
			nextDueDate: plan.dueAt,
			...(expectedUpdatedAt && { updatedAt: expectedUpdatedAt }),
		},
		data: { nextDueDate: plan.nextDueDate, anchorDay: plan.anchorDay },
	});
	if (advanced.count > 0) return;
	const now = await tx.recurringTemplate.findFirst({
		where: { id: plan.templateId, userId },
		select: { nextDueDate: true, updatedAt: true },
	});
	throw lostAdvance(
		call,
		now && { nextDueDate: now.nextDueDate, stamp: now.updatedAt.toISOString() },
		plan.dueAt,
		expectedUpdatedAt?.toISOString(),
	);
}
