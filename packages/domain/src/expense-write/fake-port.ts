/** A fake expense port for the edit and put-body tests: one row, a call log, a rate table. */
import type { BookContext } from "../rate-booking";
import type { CategoryFacts } from "./category";
import type { ExpenseEditPort, ExpensePatch, StoredExpense } from "./edit";

export const DAY = new Date("2026-03-05T15:00:00Z");

/** USD 100 booked at ARS blue 1545: home 154,500.00. */
export const arsRow: StoredExpense = {
	id: "e1",
	title: "Lunch",
	amount: "100",
	currency: "USD",
	date: DAY,
	direction: "OUT",
	isAmortizedChild: false,
	isAmortizedParent: false,
	hasLegs: false,
	exchangeRate: "1",
	amountInUSD: "100.00",
	rateType: "blue",
	homeCurrency: "ARS",
	homeRate: "1545",
	homeAmount: "154500.00",
	pricingSource: "MANUAL",
	location: null,
	description: null,
	categoryId: "c-old",
	excludeFromAnalytics: false,
};

/** One rate per currency (units per USD); a currency not listed has none. */
export const table = (
	rates: Record<string, { rate: number; type: string }>,
	home: string,
	preferred: string | null = null,
): BookContext => ({
	homeCurrency: home,
	preferred,
	find: async (currency, date) => {
		const hit = rates[currency];
		return hit ? { ...hit, date, onOrBefore: true } : null;
	},
});

export const ars = table({ ARS: { rate: 1545, type: "blue" } }, "ARS", "blue");

export function fakePort(
	row: StoredExpense | null,
	opts: { book?: BookContext; categories?: CategoryFacts[] } = {},
) {
	const log: string[] = [];
	const written: ExpensePatch[] = [];
	const port: ExpenseEditPort = {
		expense: async (id) => {
			log.push("expense");
			return row && row.id === id ? row : null;
		},
		category: async (id) => {
			log.push("category");
			return opts.categories?.find((c) => c.id === id) ?? null;
		},
		rateBook: async () => {
			log.push("rateBook");
			return opts.book ?? ars;
		},
		write: async (_id, patch) => {
			log.push("write");
			written.push(patch);
			const set = Object.fromEntries(
				Object.entries(patch).filter(([, v]) => v !== undefined),
			);
			return { ...(row as StoredExpense), ...set };
		},
		remove: async () => {
			log.push("remove");
		},
	};
	return { port, log, written };
}
