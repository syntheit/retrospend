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
	/** Every envelope change of rows in a book: whose rows ("source" or "target"), from where, to where. */
	rerouted: Reroute[];
}

export interface Reroute {
	bookId: string;
	rows: "source" | "target";
	from: string;
	to: string;
}

/**
 * The unique key on (book, category) decides: where the target is already
 * linked in a book, the source's link goes and its rows follow the target's
 * envelope. Where it is not, the source's link moves onto the target, so the
 * target's own rows (which sat in the book's default envelope) follow the
 * source's envelope. With no target the source's rows fall back to the
 * default envelope. `rerouted` lists every one of those changes.
 */
export function planLinks(
	source: readonly LinkFacts[],
	target: readonly LinkFacts[] | null,
	defaultEnvelopes: ReadonlyMap<string, string>,
): LinkPlan {
	const plan: LinkPlan = { move: [], drop: [], rerouted: [] };
	const targetByBook = new Map((target ?? []).map((l) => [l.bookId, l]));
	const reroute = (
		bookId: string,
		rows: Reroute["rows"],
		from: string,
		to: string | undefined,
	) => {
		if (to && to !== from) plan.rerouted.push({ bookId, rows, from, to });
	};
	for (const link of source) {
		const same = targetByBook.get(link.bookId);
		const fallback = defaultEnvelopes.get(link.bookId);
		if (target && !same) {
			plan.move.push(link.id);
			if (fallback) reroute(link.bookId, "target", fallback, link.envelopeId);
			continue;
		}
		plan.drop.push(link.id);
		reroute(
			link.bookId,
			"source",
			link.envelopeId,
			same?.envelopeId ?? fallback,
		);
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
	/** The same for the target: its rows move too when the source's link lands on it. */
	readonly targetMonths: ReadonlySet<MonthKey>;
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
 * The first closed month in which a row of the source or of the target would
 * land in another envelope. A month routes by the links it closed with (a
 * month with none, by today's links), and the merge changes today's links:
 * the source's goes, and the target takes its envelope when it had none. So a
 * source row moves to the target's route, and a legacy month's target rows
 * move to the source's envelope. The merge is refused then, never written
 * into a closed month.
 */
export function closedMonthClash(f: ClosedMonthFacts): MonthKey | null {
	const after = linksAfterMerge(f);
	const route = (links: ReadonlyMap<string, string>, id: string | null) =>
		envelopeForCategory(links, f.envelopeIds, f.defaultEnvelopeId, id);
	for (const m of [...f.closed].sort((a, b) => a.month - b.month)) {
		const before = m.links ?? f.links;
		const later = m.links ?? after;
		if (
			f.sourceMonths.has(m.month) &&
			route(before, f.sourceId) !== route(later, f.targetId)
		)
			return m.month;
		if (
			f.targetId &&
			f.targetMonths.has(m.month) &&
			route(before, f.targetId) !== route(later, f.targetId)
		)
			return m.month;
	}
	return null;
}
