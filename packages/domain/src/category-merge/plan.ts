/**
 * The category merge's rules, once, for the server (and a device later): what
 * a merge or delete may join, which rows it reaches, and the pure decisions
 * its move makes (budgets, envelope links, preferences, drafts) so the move
 * and its undo read one plan. The server reads the rows and writes them; it
 * decides nothing here a second time.
 *
 * `target` null is a delete: the rows become uncategorized.
 */
import { envelopeForCategory } from "../envelope/engine";
import type { MonthKey } from "../envelope/types";
import { ANY_POLICY, reach } from "../expense-write/policy";
import { CategoryMergeRefusal } from "./refusals";

/**
 * Every row the category holds moves: income, a transfer's fee, a spread
 * parent and its parts. The entry policy would hide those, which is right for
 * an edit and wrong for a merge (the category cannot go while rows point at it).
 */
export const MERGE_ROW_POLICY = ANY_POLICY;

/** Whether the merge moves this expense row. Always, under MERGE_ROW_POLICY; kept as a call so a narrower policy would show here. */
export const mergeMovesRow = (row: {
	direction: string;
	isAmortizedChild: boolean;
	hasLegs: boolean;
}) => {
	reach(row, MERGE_ROW_POLICY);
	return true;
};

/**
 * Income and expense categories are not joined: spent leaves out rows in an
 * income category, so a cross-kind move would silently move money into or out
 * of spent. The kind is compared as stored; a delete (no target) has no pair.
 */
export function checkMergeKinds(
	source: { kind: string },
	target: { kind: string } | null,
): void {
	if (target && target.kind !== source.kind)
		throw new CategoryMergeRefusal("category_kind_mismatch");
}

export interface BudgetFacts {
	readonly id: string;
	/** The period as a stable key (the instant in ms). */
	readonly period: number;
}

/**
 * The source's budgets: one for a period the target already budgets is
 * dropped (the target's is kept); the rest move. With no target a budget with
 * no category would read as a global one, so all of them are dropped.
 */
export function planBudgets(
	source: readonly BudgetFacts[],
	targetPeriods: ReadonlySet<number> | null,
): { move: string[]; drop: string[] } {
	const move: string[] = [];
	const drop: string[] = [];
	for (const b of source) {
		if (targetPeriods && !targetPeriods.has(b.period)) move.push(b.id);
		else drop.push(b.id);
	}
	return { move, drop };
}

export interface LinkFacts {
	readonly id: string;
	readonly bookId: string;
	readonly envelopeId: string;
}

export interface LinkPlan {
	/** Source links the target has none of: they take the target's id and keep their envelope. */
	move: string[];
	/** Source links the target has one of (or all, with no target): the row goes. */
	drop: string[];
	/** Where the source's rows now land, per book, where that differs. */
	rerouted: { bookId: string; from: string; to: string }[];
}

/**
 * The unique key on (book, category) decides: where the target is already
 * linked in a book, the source's link goes and its rows follow the target's
 * envelope. With no target the rows fall back to the book's default envelope.
 */
export function planLinks(
	source: readonly LinkFacts[],
	target: readonly LinkFacts[] | null,
	defaultEnvelopes: ReadonlyMap<string, string>,
): LinkPlan {
	const plan: LinkPlan = { move: [], drop: [], rerouted: [] };
	const targetByBook = new Map((target ?? []).map((l) => [l.bookId, l]));
	for (const link of source) {
		const same = targetByBook.get(link.bookId);
		if (target && !same) {
			plan.move.push(link.id);
			continue;
		}
		plan.drop.push(link.id);
		const to = same?.envelopeId ?? defaultEnvelopes.get(link.bookId);
		if (to && to !== link.envelopeId)
			plan.rerouted.push({ bookId: link.bookId, from: link.envelopeId, to });
	}
	return plan;
}

/** The target's analytics preference wins; the source's moves only when the target has none (and drops with no target). */
export function planPreference(
	sourceId: string | null,
	targetHasOne: boolean,
	hasTarget: boolean,
): "move" | "drop" | "none" {
	if (!sourceId) return "none";
	return hasTarget && !targetHasOne ? "move" : "drop";
}

interface DraftRow {
	categoryId?: string | null;
}

export interface DraftRows {
	expectedIn: unknown;
	pretend: unknown;
}

/** Which rows of a draft a move changed, by position, so the undo flips only those. */
export interface DraftChange {
	expectedIn: number[];
	pretend: number[];
}

function swapRows(
	value: unknown,
	where: (row: DraftRow, index: number) => boolean,
	to: string | null,
): { rows: unknown; changed: number[] } {
	if (!Array.isArray(value)) return { rows: value, changed: [] };
	const changed: number[] = [];
	const rows = value.map((row: DraftRow, index) => {
		if (!where(row, index)) return row;
		changed.push(index);
		return { ...row, categoryId: to };
	});
	return { rows, changed };
}

/** A draft's expected money in and pretend rows with `from` replaced by `to`, and where; null when it names `from` nowhere. */
export function moveDraftCategory(
	draft: DraftRows,
	from: string,
	to: string | null,
): { next: DraftRows; changed: DraftChange } | null {
	const named = (row: DraftRow) => row?.categoryId === from;
	const expectedIn = swapRows(draft.expectedIn, named, to);
	const pretend = swapRows(draft.pretend, named, to);
	if (expectedIn.changed.length + pretend.changed.length === 0) return null;
	return {
		next: { expectedIn: expectedIn.rows, pretend: pretend.rows },
		changed: { expectedIn: expectedIn.changed, pretend: pretend.changed },
	};
}

/** The undo of `moveDraftCategory`: the rows it changed take `back` again. */
export function restoreDraftCategory(
	draft: DraftRows,
	changed: DraftChange,
	back: string,
): DraftRows {
	const at = (list: readonly number[]) => (_: DraftRow, i: number) =>
		list.includes(i);
	return {
		expectedIn: swapRows(draft.expectedIn, at(changed.expectedIn), back).rows,
		pretend: swapRows(draft.pretend, at(changed.pretend), back).rows,
	};
}

export interface ClosedMonthRouting {
	readonly month: MonthKey;
	/** The links the month closed with; null when it kept none, and today's links then route it. */
	readonly links: ReadonlyMap<string, string> | null;
}

export interface ClosedMonthFacts {
	readonly sourceId: string;
	readonly targetId: string | null;
	readonly defaultEnvelopeId: string;
	readonly envelopeIds: ReadonlySet<string>;
	/** Today's category to envelope links of the book, before the move. */
	readonly links: ReadonlyMap<string, string>;
	readonly closed: readonly ClosedMonthRouting[];
	/** The budget months holding a row, a share or a shared expense filed under the source. */
	readonly sourceMonths: ReadonlySet<MonthKey>;
}

/** Today's links once the merge ran: the source's is gone, and the target takes its envelope when it had none. */
function linksAfterMerge(f: ClosedMonthFacts): ReadonlyMap<string, string> {
	const out = new Map(f.links);
	out.delete(f.sourceId);
	const inherited = f.links.get(f.sourceId);
	if (f.targetId && inherited && !out.has(f.targetId))
		out.set(f.targetId, inherited);
	return out;
}

/**
 * The first closed month whose rows would land in another envelope: a month
 * routes by the links it closed with (a month with none, by today's), so a
 * merge that gives the source's rows the target's route changes a closed
 * month's figures exactly when the two routes differ there and the source has
 * rows in it. The merge is refused then, never written into a closed month.
 */
export function closedMonthClash(f: ClosedMonthFacts): MonthKey | null {
	const after = linksAfterMerge(f);
	const route = (links: ReadonlyMap<string, string>, id: string | null) =>
		envelopeForCategory(links, f.envelopeIds, f.defaultEnvelopeId, id);
	for (const m of [...f.closed].sort((a, b) => a.month - b.month)) {
		if (!f.sourceMonths.has(m.month)) continue;
		const was = route(m.links ?? f.links, f.sourceId);
		const will = m.links
			? route(m.links, f.targetId)
			: route(after, f.targetId);
		if (was !== will) return m.month;
	}
	return null;
}
