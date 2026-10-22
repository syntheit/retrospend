/**
 * Auto-fill (SPEC §5.4): overspent envelopes to 0, bills by due date, group
 * targets in group order (§5.9), Monthly, then Savings.
 */
import type { EnvelopeKind, IsoDate, Minor } from "./types";

export type FillStep = "OVERSPENT" | "BILL" | "GROUP" | "MONTHLY" | "SAVINGS";

export interface FillCandidate {
	envelopeId: string;
	kind: EnvelopeKind;
	/** Display order within the book (group order, then envelope order). */
	order: number;
	left: Minor;
	need: Minor;
	/** BILL: the cycle's due date. */
	dueDate?: IsoDate | null;
}

/** A group with a target (groups.ts groupPlan): its children fill first, then the main envelope. */
export interface TargetedGroup {
	groupOrder: number;
	envelopeIds: readonly string[];
	mainEnvelopeId: string | null;
	/** Group need left after the children's own needs. */
	mainExtra: Minor;
}

export interface FillLine {
	envelopeId: string;
	amount: Minor;
	step: FillStep;
}

type QueueItem = { envelopeId: string; want: Minor; step: FillStep };

function groupSteps(
	byOrder: readonly FillCandidate[],
	groups: readonly TargetedGroup[],
) {
	const out: QueueItem[] = [];
	for (const g of [...groups].sort((a, b) => a.groupOrder - b.groupOrder)) {
		for (const c of byOrder) {
			if (c.kind === "BILL" || !g.envelopeIds.includes(c.envelopeId)) continue;
			out.push({ envelopeId: c.envelopeId, want: c.need, step: "GROUP" });
		}
		if (g.mainEnvelopeId && g.mainExtra > 0) {
			out.push({
				envelopeId: g.mainEnvelopeId,
				want: g.mainExtra,
				step: "GROUP",
			});
		}
	}
	return out;
}

function fillQueue(
	cands: readonly FillCandidate[],
	groups: readonly TargetedGroup[],
) {
	const byOrder = [...cands].sort((a, b) => a.order - b.order);
	const byDue = (a: FillCandidate, b: FillCandidate) =>
		(a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
		a.order - b.order;
	const inGroup = new Set(groups.flatMap((g) => g.envelopeIds));
	const queue: QueueItem[] = [];
	for (const c of byOrder) {
		if (c.left < 0)
			queue.push({
				envelopeId: c.envelopeId,
				want: -c.left,
				step: "OVERSPENT",
			});
	}
	for (const c of byOrder.filter((x) => x.kind === "BILL").sort(byDue)) {
		queue.push({ envelopeId: c.envelopeId, want: c.need, step: "BILL" });
	}
	queue.push(...groupSteps(byOrder, groups));
	for (const kind of ["MONTHLY", "SAVINGS"] as const) {
		for (const c of byOrder) {
			if (c.kind === kind && !inGroup.has(c.envelopeId)) {
				queue.push({ envelopeId: c.envelopeId, want: c.need, step: kind });
			}
		}
	}
	return queue;
}

/**
 * Auto-fill (SPEC §5.4): overspent envelopes to 0, bills by due date, group
 * targets in group order (children, then the main envelope's extra, §5.9),
 * Monthly, then Savings, until `available` runs out.
 * Money that covers an overspend also counts toward that envelope's need,
 * since every need subtracts what is assigned this month.
 */
export function autoFill(
	available: Minor,
	candidates: readonly FillCandidate[],
	groups: readonly TargetedGroup[] = [],
): { lines: FillLine[]; left: Minor } {
	let left = Math.max(0, available);
	const covered = new Map<string, Minor>();
	const lines: FillLine[] = [];
	for (const item of fillQueue(candidates, groups)) {
		const cover =
			item.step === "OVERSPENT" ? 0 : (covered.get(item.envelopeId) ?? 0);
		const amount = Math.min(left, Math.max(0, item.want - cover));
		if (amount <= 0) continue;
		lines.push({ envelopeId: item.envelopeId, amount, step: item.step });
		if (item.step === "OVERSPENT") covered.set(item.envelopeId, amount);
		left -= amount;
	}
	return { lines, left };
}
