/**
 * What the loader (inputs.ts) keeps between reads: foreign rows' frozen
 * values (budget_row_value, 02 §3.4), the rules each closed month closed
 * under (MonthClose snapshots, B7), and the mark a stale checkpoint leaves
 * when no trigger saw its change.
 */
import type { Prisma } from "~prisma";
import type { CloseRow, DirtyMark } from "./close-rows";
import type { ClosedRule } from "./engine";
import type { Valuer } from "./entries";
import type { MissingRate, MonthKey } from "./types";

type Tx = Prisma.TransactionClient;

/**
 * A closed month whose fully loaded rows no longer match its checkpoint, with
 * no mark to say so (a change no trigger saw, a claimed shadow's share): one
 * mark from it, so the next read revises it under the book lock.
 */
export async function markStale(
	tx: Tx,
	bookId: string,
	closes: readonly CloseRow[],
	prints: ReadonlyMap<MonthKey, string>,
	dirty: readonly DirtyMark[],
) {
	const stale = closes.find(
		(c) =>
			c.checkpoint &&
			prints.has(c.month) &&
			prints.get(c.month) !== c.checkpoint.print,
	);
	if (!stale || dirty.some((d) => d.fromMonth <= stale.month)) return;
	await tx.budgetDirty.create({ data: { bookId, fromMonth: stale.month } });
}

/** Foreign rows' values frozen by earlier loads (budget_row_value). */
export async function frozenValues(tx: Tx, bookId: string) {
	const rows = await tx.budgetRowValue.findMany({
		where: { bookId },
		select: { key: true, minor: true },
	});
	return new Map(rows.map((r) => [r.key, Number(r.minor)]));
}

/** Freezes what this load valued for the first time; a concurrent load writing the same key is a no-op. */
export async function freeze(tx: Tx, bookId: string, valuer: Valuer) {
	if (valuer.fresh.length === 0) return;
	await tx.budgetRowValue.createMany({
		data: valuer.fresh.map((f) => ({
			bookId,
			key: f.key,
			minor: BigInt(f.minor),
		})),
		skipDuplicates: true,
	});
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
	closes: readonly CloseRow[],
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
