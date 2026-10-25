/**
 * Proposals the assign and cover sheets start from, read off one month view
 * so they use exactly the numbers on the page.
 *
 * - Fill from targets ("Use my plan", SPEC §5.4 auto-fill order): what went
 *   over back to 0, bills by due date, Monthly, then Savings, until the
 *   money runs out. What is left stays Not planned yet; nothing moves it
 *   unseen (D-owner-2026-10-22e).
 * - Cover sources (SPEC §6.5): To assign if positive, then Monthly envelopes
 *   by Left, then Savings, then Bills last with their due date.
 * - Move caps (S15): a move out of an envelope takes at most max(0, Left).
 */
import type {
	CoverOverview,
	CoverSource,
	EnvelopeRowDto,
	FillFromTargetsOutput,
	GetMonthOutput,
	RestOption,
} from "~/lib/schemas/envelope";
import {
	autoFill,
	type FillCandidate,
	type FillStep,
	type TargetedGroup,
} from "./auto-fill";
import { addMonths } from "./calendar";
import type { Minor } from "./types";

function rowsOf(
	view: GetMonthOutput,
): Array<EnvelopeRowDto & { order: number }> {
	return view.groups.flatMap((g, gi) =>
		g.envelopes.map((e, ei) => ({ ...e, order: gi * 10_000 + ei })),
	);
}

/** A saved plan's line (Plan next month): what the envelope should have assigned in the month. */
export interface SavedPlanLine {
	envelopeId: string;
	amountMinor: Minor;
}

/**
 * The saved plan first (owner r5 Q1: a plan funds itself when the month's
 * money arrives): each envelope up to its planned Assigned, in plan order.
 */
function planSteps(
	rows: ReadonlyArray<EnvelopeRowDto>,
	plan: readonly SavedPlanLine[],
	available: Minor,
): { lines: Map<string, Minor>; left: Minor } {
	const assigned = new Map(rows.map((r) => [r.id, r.assigned.minor]));
	const lines = new Map<string, Minor>();
	let left = available;
	for (const p of plan) {
		if (!assigned.has(p.envelopeId)) continue;
		const want = Math.max(0, p.amountMinor - (assigned.get(p.envelopeId) ?? 0));
		const amount = Math.min(left, want);
		if (amount <= 0) continue;
		lines.set(p.envelopeId, amount);
		left -= amount;
	}
	return { lines, left };
}

/** Targeted groups (SPEC §5.9) for auto-fill, after what the saved plan already gave them. */
function targetedGroups(
	view: GetMonthOutput,
	given: ReadonlyMap<string, Minor>,
): TargetedGroup[] {
	return view.groups.flatMap((g) => {
		const t = g.target;
		if (!t || g.id === null) return [];
		const gave = g.envelopes.reduce((s, e) => s + (given.get(e.id) ?? 0), 0);
		const groupNeed = Math.max(0, t.need.minor - gave);
		const childNeeds = g.envelopes
			.filter((e) => e.target !== null)
			.reduce(
				(s, e) =>
					s + Math.max(0, (e.target?.need.minor ?? 0) - (given.get(e.id) ?? 0)),
				0,
			);
		return [
			{
				groupOrder: g.sortOrder,
				envelopeIds: g.envelopes.map((e) => e.id),
				mainEnvelopeId: t.mainEnvelopeId,
				mainExtra: t.mainEnvelopeId ? Math.max(0, groupNeed - childNeeds) : 0,
			},
		];
	});
}

/**
 * "Use my plan" for `amount` (default: all of a positive To assign): the
 * saved plan for the month when there is one, then the targets (overspent,
 * bills, group targets, Monthly, Savings), each need less what the plan gave.
 */
export function fillFromTargets(
	view: GetMonthOutput,
	amount?: Minor,
	plan: readonly SavedPlanLine[] = [],
): FillFromTargetsOutput {
	const currency = view.book.currency;
	const available = Math.max(0, amount ?? view.toAssign.amount.minor);
	const rows = rowsOf(view);
	const planned = planSteps(rows, plan, available);
	const candidates: FillCandidate[] = rows.map((r) => ({
		envelopeId: r.id,
		kind: r.kind,
		order: r.order,
		left: r.left.minor + (planned.lines.get(r.id) ?? 0),
		need: Math.max(
			0,
			(r.target?.need.minor ?? 0) - (planned.lines.get(r.id) ?? 0),
		),
		dueDate: r.target?.dueDate ?? null,
	}));
	const { lines, left } = autoFill(
		planned.left,
		candidates,
		targetedGroups(view, planned.lines),
	);
	const line = (envelopeId: string, minor: Minor, step: FillStep | "PLAN") => ({
		envelopeId,
		month: view.month.key,
		amount: { minor, currency },
		step,
	});
	const all = [
		...[...planned.lines].map(([id, minor]) => line(id, minor, "PLAN")),
		...lines.map((l) => line(l.envelopeId, l.amount, l.step)),
	];
	const sums = new Map<string, Minor>();
	for (const l of all)
		sums.set(l.envelopeId, (sums.get(l.envelopeId) ?? 0) + l.amount.minor);
	return {
		month: view.month.key,
		available: { minor: available, currency },
		lines: all,
		totals: [...sums].map(([envelopeId, minor]) => ({
			envelopeId,
			amount: { minor, currency },
		})),
		rest: { minor: left, currency },
		restOptions: restOptions(view),
	};
}

/**
 * Where "Save it" puts the rest (kit budget-plan.js saveHome): the first
 * savings goal in the Savings group whose date is still ahead, else the
 * group's first envelope. Null without a Savings group.
 */
export function saveHome(view: GetMonthOutput): string | null {
	const ahead = rowsOf(view).filter(
		(e) =>
			view.groups.some(
				(g) => g.role === "SAVINGS" && g.envelopes.some((x) => x.id === e.id),
			) && !(e.target?.dueDate && e.target.dueDate < view.today),
	);
	return (ahead.find((e) => e.kind === "SAVINGS") ?? ahead[0])?.id ?? null;
}

/**
 * The rest's choices after Use my plan (D-owner-2026-10-22e): Save it (when
 * there is a savings home), Next month (from the current month only, D22)
 * and Leave it, the default.
 */
export function restOptions(view: GetMonthOutput): RestOption[] {
	const home = saveHome(view);
	const options: RestOption[] = [];
	if (home) options.push({ choice: "SAVE", envelopeId: home, month: null });
	if (view.month.state === "OPEN")
		options.push({
			choice: "NEXT_MONTH",
			envelopeId: null,
			month: addMonths(view.month.key, 1),
		});
	options.push({ choice: "LEAVE", envelopeId: null, month: null });
	return options;
}

const KIND_RANK = { MONTHLY: 0, NONE: 0, SAVINGS: 1, BILL: 2 } as const;

/** Where money to cover `envelopeId` can come from, largest first within each tier. */
export function coverSources(
	view: GetMonthOutput,
	envelopeId: string,
): CoverSource[] {
	const currency = view.book.currency;
	const pool: CoverSource[] =
		view.toAssign.amount.minor > 0
			? [
					{
						from: null,
						kind: "POOL",
						available: view.toAssign.amount,
						dueDate: null,
					},
				]
			: [];
	const envelopes = rowsOf(view)
		.filter((r) => r.id !== envelopeId && r.left.minor > 0)
		.sort(
			(a, b) =>
				KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.left.minor - a.left.minor,
		)
		.map(
			(r): CoverSource => ({
				from: r.id,
				kind: r.kind,
				available: { minor: r.left.minor, currency },
				dueDate: r.kind === "BILL" ? (r.target?.dueDate ?? null) : null,
			}),
		);
	return [...pool, ...envelopes];
}

/**
 * Covering one envelope: what it is over by and the source the sheet starts
 * on (SPEC §6.5). A goal or a bill is never suggested by default: the first
 * source that holds enough, else the first To assign or Monthly one.
 */
export function coverOverview(
	view: GetMonthOutput,
	envelopeId: string,
): CoverOverview {
	const currency = view.book.currency;
	const row = rowsOf(view).find((r) => r.id === envelopeId);
	const need = Math.max(0, -(row?.left.minor ?? 0));
	const sources = coverSources(view, envelopeId);
	const flexible = sources.filter(
		(s) => s.kind === "POOL" || s.kind === "MONTHLY" || s.kind === "NONE",
	);
	const pick =
		flexible.find((s) => s.available.minor >= need) ?? flexible[0] ?? null;
	return {
		need: { minor: need, currency },
		suggested: pick ? { from: pick.from } : null,
		sources,
	};
}

/** The most a move can take out of an envelope (S15). */
export function moveCap(row: Pick<EnvelopeRowDto, "left">): Minor {
	return Math.max(0, row.left.minor);
}

/**
 * The most that can go from an envelope back to To assign. This month: what
 * the envelope holds. Next month: also no more than was assigned to it there,
 * and no more than To assign gave next month in total. Next month's Left
 * includes this month's projected carry, which To assign already counts, so
 * taking that back would show the same money twice.
 */
export function takeBackCap(p: {
	month: number;
	currentMonth: number;
	left: Minor;
	/** Assigned(e, month): net movements into the envelope that month. */
	assigned: Minor;
	/** Net movements out of To assign that month. */
	poolAssigned: Minor;
}): Minor {
	if (p.month <= p.currentMonth) return Math.max(0, p.left);
	return Math.max(0, Math.min(p.left, p.assigned, p.poolAssigned));
}
