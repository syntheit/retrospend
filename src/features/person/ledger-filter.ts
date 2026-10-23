/**
 * "Between you": shared expenses and payments in one list, newest first and
 * grouped by month, with the page's chips and the project scope. Filtering
 * and grouping only; every amount is the server's.
 */
import { fold } from "~/features/people/filter";
import type { LedgerRowDTO, PaymentDTO } from "~/features/people/types";

export type LedgerItem =
	| { kind: "expense"; date: string; row: LedgerRowDTO }
	| { kind: "payment"; date: string; payment: PaymentDTO };

export type LedgerFilters = {
	query: string;
	/** Still moves the balance: an unsettled expense between you, a pending payment. */
	outstanding: boolean;
	review: boolean;
	payments: boolean;
	paidBy: "me" | "them" | null;
	/** A project id, "none" for Outside projects, null for all. */
	scope: string | null;
};

export const NO_LEDGER_FILTERS: LedgerFilters = {
	query: "",
	outstanding: false,
	review: false,
	payments: false,
	paidBy: null,
	scope: null,
};

/** Expenses and payments merged, newest first; a payment before an expense on the same day. */
export function ledgerItems(
	rows: readonly LedgerRowDTO[],
	payments: readonly PaymentDTO[],
): LedgerItem[] {
	const items: LedgerItem[] = [
		...rows.map((row) => ({ kind: "expense" as const, date: row.date, row })),
		...payments.map((payment) => ({
			kind: "payment" as const,
			date: payment.paidOn,
			payment,
		})),
	];
	return items.sort((a, b) =>
		a.date !== b.date
			? b.date.localeCompare(a.date)
			: a.kind === b.kind
				? 0
				: a.kind === "payment"
					? -1
					: 1,
	);
}

function scopeMatches(item: LedgerItem, scope: string | null): boolean {
	if (scope === null) return true;
	if (item.kind === "expense")
		return (item.row.project?.id ?? "none") === scope;
	return item.payment.parts.some((p) => (p.project?.id ?? "none") === scope);
}

export function matchesItem(
	item: LedgerItem,
	f: LedgerFilters,
	categoryText = "",
): boolean {
	if (!scopeMatches(item, f.scope)) return false;
	if (item.kind === "payment") {
		const p = item.payment;
		if (f.review) return false;
		if (f.outstanding && p.status !== "pending") return false;
		if (f.paidBy && (f.paidBy === "me") !== (p.direction === "out"))
			return false;
		return !f.query || fold(p.method ?? "").includes(fold(f.query));
	}
	const r = item.row;
	if (f.payments) return false;
	if (f.review && r.state !== "review") return false;
	if (f.outstanding && (r.effect === null || r.state === "settled"))
		return false;
	if (f.paidBy && r.paidBy !== f.paidBy) return false;
	if (!f.query) return true;
	const q = fold(f.query.trim());
	return fold(`${r.title} ${r.category?.name ?? ""} ${categoryText}`).includes(
		q,
	);
}

/** Consecutive items of one month together, keyed "YYYY-MM". */
export function byMonth(
	items: readonly LedgerItem[],
): { month: string; items: LedgerItem[] }[] {
	const out: { month: string; items: LedgerItem[] }[] = [];
	for (const item of items) {
		const month = item.date.slice(0, 7);
		const last = out.at(-1);
		if (last?.month === month) last.items.push(item);
		else out.push({ month, items: [item] });
	}
	return out;
}
