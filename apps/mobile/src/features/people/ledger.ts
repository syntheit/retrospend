import type { PersonPage } from "./source";

type Row = PersonPage["rows"][number];
type Payment = PersonPage["payments"][number];

/** One line of "Between you": a shared expense, or a payment between you. */
export type LedgerItem =
	| { kind: "expense"; id: string; day: string; row: Row }
	| { kind: "payment"; id: string; day: string; payment: Payment };

/** What the toolbar chips narrow to; the ones that are on all apply. */
export type LedgerChip =
	| "outstanding"
	| "review"
	| "payments"
	| "paidByMe"
	| "paidByThem";

export const LEDGER_CHIPS: LedgerChip[] = [
	"outstanding",
	"review",
	"payments",
	"paidByMe",
	"paidByThem",
];

export interface LedgerMonth {
	/** YYYY-MM. */
	month: string;
	items: LedgerItem[];
}

/**
 * The expenses and the payments as one list, newest first; on one day a
 * payment comes first. While only the newest expenses are loaded, a payment
 * older than the oldest of them is left out, so it never sits ahead of
 * expenses that are not shown yet.
 */
export function mergeLedger(
	rows: Row[],
	payments: Payment[],
	complete: boolean,
): LedgerItem[] {
	const oldest = rows.reduce<string | null>(
		(min, row) => (min === null || row.date < min ? row.date : min),
		null,
	);
	const items: LedgerItem[] = [
		...rows.map((row) => ({
			kind: "expense" as const,
			id: row.id,
			day: row.date,
			row,
		})),
		...payments
			.filter((p) => complete || oldest === null || p.paidOn >= oldest)
			.map((payment) => ({
				kind: "payment" as const,
				id: payment.id,
				day: payment.paidOn,
				payment,
			})),
	];
	return items.sort((a, b) =>
		a.day === b.day
			? a.kind === b.kind
				? 0
				: a.kind === "payment"
					? -1
					: 1
			: a.day < b.day
				? 1
				: -1,
	);
}

/** Whether a line passes one chip. */
export function passes(item: LedgerItem, chip: LedgerChip): boolean {
	if (item.kind === "payment") {
		const { payment } = item;
		switch (chip) {
			case "outstanding":
				return payment.status === "pending";
			case "review":
				return false;
			case "payments":
				return true;
			case "paidByMe":
				return payment.direction === "out";
			case "paidByThem":
				return payment.direction === "in";
		}
	}
	const { row } = item;
	switch (chip) {
		case "outstanding":
			return row.effect !== null && row.state !== "settled";
		case "review":
			return row.state === "review";
		case "payments":
			return false;
		case "paidByMe":
			return row.paidBy === "me";
		case "paidByThem":
			return row.paidBy === "them";
	}
}

const fold = (text: string) =>
	text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The words a search looks in: an expense's title, category and project; a payment's method. */
function haystack(item: LedgerItem): string {
	if (item.kind === "payment") return item.payment.method ?? "";
	const { row } = item;
	return [row.title, row.category?.name, row.project?.name]
		.filter(Boolean)
		.join(" ");
}

/** The lines that pass every chip that is on and contain the search text. */
export function filterLedger(
	items: LedgerItem[],
	chips: ReadonlySet<LedgerChip>,
	query: string,
): LedgerItem[] {
	const needle = fold(query.trim());
	return items.filter(
		(item) =>
			[...chips].every((chip) => passes(item, chip)) &&
			(needle === "" || fold(haystack(item)).includes(needle)),
	);
}

/** Month groups in the order of the lines. */
export function groupByMonth(items: LedgerItem[]): LedgerMonth[] {
	const months: LedgerMonth[] = [];
	for (const item of items) {
		const month = item.day.slice(0, 7);
		const last = months[months.length - 1];
		if (last && last.month === month) last.items.push(item);
		else months.push({ month, items: [item] });
	}
	return months;
}
