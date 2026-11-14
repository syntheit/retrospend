/**
 * What the loader (load-book.ts) derives from the state it read: the rules
 * each closed month closed under (MonthClose snapshots, B7), the one stale
 * mark a load may owe, and the lists of missing and approximate rows without
 * duplicates. Pure; storing the mark and the frozen values is the caller's.
 */
import type { CloseRowCore, DirtyMark, LoadedBook } from "./book-source";
import type { ClosedRule } from "./engine";
import { budgetMonthOf } from "./months";
import type { MissingRate, MonthKey } from "./types";
import type { ApproximateRow } from "./valuer";

/**
 * The month a closed month's checkpoint no longer matches the fully loaded
 * rows with no mark to say so (a change no trigger saw, a claimed shadow's
 * share): the caller writes one mark from it, so the next read revises it
 * under the book lock. Null when nothing is stale or a mark already covers it.
 */
export function staleMarkOf(
	closes: readonly Pick<CloseRowCore, "month" | "checkpoint">[],
	prints: ReadonlyMap<MonthKey, string>,
	dirty: readonly Pick<DirtyMark, "fromMonth">[],
): MonthKey | null {
	const stale = closes.find(
		(c) =>
			c.checkpoint &&
			prints.has(c.month) &&
			prints.get(c.month) !== c.checkpoint.print,
	);
	if (!stale || dirty.some((d) => d.fromMonth <= stale.month)) return null;
	return stale.month;
}

/** One entry per approximate row (a checkpoint and the full share load can both name it). */
export function uniqueApproximate(
	rows: readonly ApproximateRow[],
): ApproximateRow[] {
	return [...new Map(rows.map((r) => [r.rowId, r])).values()];
}

/** Same rate, same row: listed once (a checkpoint and the full share load can both name it). */
export function uniqueMissing(rates: readonly MissingRate[]): MissingRate[] {
	const seen = new Map<string, MissingRate>();
	for (const r of rates)
		seen.set(`${r.rowId ?? ""}|${r.currency}|${r.rateType}|${r.date}`, r);
	return [...seen.values()];
}

/** The leftover rules each closed month closed under (MonthClose snapshots, B7). */
export function closedRulesOf(
	closes: readonly Pick<CloseRowCore, "month" | "summary">[],
): Map<MonthKey, Map<string, ClosedRule>> {
	const out = new Map<MonthKey, Map<string, ClosedRule>>();
	for (const c of closes)
		out.set(
			c.month,
			new Map(
				c.summary.envelopes.map((e) => [
					e.id,
					{ rule: e.rule, sweepToId: e.sweepToId },
				]),
			),
		);
	return out;
}

/** Approximate rows of months up to `month`: what a checkpoint there carries. */
export function approximateThrough(
	loaded: Pick<LoadedBook, "approximate" | "periods">,
	month: MonthKey,
): ApproximateRow[] {
	return loaded.approximate.filter(
		(r) => budgetMonthOf(r.date, loaded.periods) <= month,
	);
}

/** Own missing rates of months up to `month`: what a checkpoint there carries. */
export function missingThrough(
	loaded: Pick<LoadedBook, "missingRates" | "periods">,
	month: MonthKey,
): MissingRate[] {
	return loaded.missingRates.filter(
		(r) => budgetMonthOf(r.date, loaded.periods) <= month,
	);
}
