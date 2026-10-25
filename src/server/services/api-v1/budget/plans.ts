import { randomUUID } from "node:crypto";
import type { MovementResult } from "~/lib/schemas/envelope";
import type { BudgetUndoPlan as UndoPlan } from "./write";

/**
 * How each budget write is taken back (an UndoPlan), kept apart from the
 * mutations so the table reads on its own. A write whose rows are all
 * movements is undone by `envelope.undo`; an edit by the id it returned; a
 * "set it to X" write by setting the previous value back.
 */

type Target = { movementId: string } | { batchId: string };

/** One target per batch, and one per movement that has no batch. */
function targetsOf(movements: MovementResult["movements"]): Target[] {
	const batches = new Set<string>();
	const targets: Target[] = [];
	for (const m of movements) {
		if (m.batchId === null) targets.push({ movementId: m.id });
		else if (!batches.has(m.batchId)) {
			batches.add(m.batchId);
			targets.push({ batchId: m.batchId });
		}
	}
	return targets;
}

/** Null when the write appended no rows: there is nothing to take back. */
export function movementPlan(
	result: Pick<MovementResult, "movements"> | null,
): UndoPlan | null {
	const targets = result ? targetsOf(result.movements) : [];
	if (targets.length === 0) return null;
	return {
		op: "movement.undo",
		args: { items: targets.map((target) => ({ id: randomUUID(), target })) },
	};
}

/** The edit's own record is what undoes it (only the newest edit of an envelope can). */
export const changePlan = (changeId: string): UndoPlan => ({
	op: "change.undo",
	args: { id: changeId },
});

export function adjustmentPlan(expenseId: string | null): UndoPlan | null {
	return expenseId
		? {
				op: "adjustment.remove",
				args: { expenseId },
				guard: { table: "expense", ids: [expenseId] },
			}
		: null;
}
