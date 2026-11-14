/**
 * What the loader (inputs.ts) keeps between reads: foreign rows' frozen
 * values (budget_row_value, 02 §3.4) and the mark a stale checkpoint leaves
 * when no trigger saw its change. What a load derives from them (the rules
 * each closed month closed under, the stale month, the lists without
 * duplicates) is pure and lives in @retrospend/domain/envelope/load-state,
 * shared with devices; the writes stay here.
 */
import type {
	FreshValue,
	FrozenValue,
	Valuer,
} from "@retrospend/domain/envelope/valuer";
import type { Prisma } from "~prisma";
import type { MonthKey } from "./types";

export {
	approximateThrough,
	closedRulesOf,
	missingThrough,
	staleMarkOf,
	uniqueApproximate,
	uniqueMissing,
} from "@retrospend/domain/envelope/load-state";

type Tx = Prisma.TransactionClient;

/**
 * One budget_dirty mark from `fromMonth`: the stale month a load found (no
 * trigger saw its change, a claimed shadow's share), so the next read revises
 * it under the book lock.
 */
export async function markDirtyFrom(
	tx: Tx,
	bookId: string,
	fromMonth: MonthKey,
) {
	await tx.budgetDirty.create({ data: { bookId, fromMonth } });
}

/** Foreign rows' values frozen by earlier loads (budget_row_value). */
export async function frozenValues(
	tx: Tx,
	bookId: string,
): Promise<Map<string, FrozenValue>> {
	const rows = await tx.budgetRowValue.findMany({
		where: { bookId },
		select: { key: true, minor: true, approximate: true },
	});
	return new Map(
		rows.map((r) => [
			r.key,
			{ minor: Number(r.minor), approximate: r.approximate },
		]),
	);
}

/** Freezes values a load made for the first time; a concurrent load writing the same key is a no-op. */
export async function freezeValues(
	tx: Tx,
	bookId: string,
	fresh: readonly FreshValue[],
) {
	if (fresh.length === 0) return;
	await tx.budgetRowValue.createMany({
		data: fresh.map((f) => ({
			bookId,
			key: f.key,
			minor: BigInt(f.minor),
			approximate: f.approximate,
			rateDate: f.rateDate ? new Date(`${f.rateDate}T00:00:00Z`) : null,
		})),
		skipDuplicates: true,
	});
}

/** Freezes what this valuer valued for the first time. */
export function freeze(tx: Tx, bookId: string, valuer: Valuer) {
	return freezeValues(tx, bookId, valuer.fresh);
}
