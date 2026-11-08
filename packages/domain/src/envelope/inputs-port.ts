/**
 * The storage port of the budget engine's inputs. Everything the envelope
 * loader reads for one person's book comes through it, so the same pure
 * valuation and entry code runs over Postgres on the server and over a local
 * store on a device. The server implements it with Prisma
 * (server/services/envelope/inputs-source.ts); a device implements it over its
 * own rows. A port reads and groups; it never values or rounds.
 */
import { type Decimal, type DecimalInput, dec } from "../precise-decimal";
import type { ExpenseRow, GroupedMovement, WealthRow } from "./entries";
import { RateBook, type RateBookParams, type RateRow } from "./rate-book";
import type { MonthKey } from "./types";

/** The person's own rows from a date on, and movement sums after a month. */
export interface OwnRows {
	/** Income, the starting balance and adjustments. */
	moneyIn: ExpenseRow[];
	spending: ExpenseRow[];
	refunds: ExpenseRow[];
	movements: GroupedMovement[];
}

export interface BudgetInputsPort {
	/** Own rows dated from `from` on; movements in months after `afterMonth`. */
	ownRows(q: { from: Date; afterMonth: MonthKey }): Promise<OwnRows>;
	/** Every Wealth move of the book: goal progress needs them all, and they are few. */
	wealthRows(): Promise<WealthRow[]>;
	/** The stored rates the book needs, oldest first (selectRateRows). */
	rateRows(p: RateBookParams): Promise<RateRow[]>;
}

export async function rateBookFrom(
	port: BudgetInputsPort,
	p: RateBookParams,
): Promise<RateBook> {
	return RateBook.fromRows(await port.rateRows(p), p);
}

/** One stored movement, before grouping. */
export interface MovementRow {
	month: MonthKey;
	fromEnvelopeId: string | null;
	toEnvelopeId: string | null;
	amount: DecimalInput;
}

/**
 * Movement sums per month, source and target, exact, for the months after
 * `afterMonth`. The JS counterpart of the server's grouped SUM over numeric:
 * both must agree to the last digit (a pg test holds them to it).
 */
export function groupMovements(
	rows: Iterable<MovementRow>,
	afterMonth: MonthKey,
): GroupedMovement[] {
	const groups = new Map<
		string,
		{ month: MonthKey; from: string | null; to: string | null; sum: Decimal }
	>();
	for (const r of rows) {
		if (r.month <= afterMonth) continue;
		const key = JSON.stringify([r.month, r.fromEnvelopeId, r.toEnvelopeId]);
		const add = dec(r.amount);
		const g = groups.get(key);
		if (g) g.sum = g.sum.plus(add);
		else
			groups.set(key, {
				month: r.month,
				from: r.fromEnvelopeId,
				to: r.toEnvelopeId,
				sum: add,
			});
	}
	return [...groups.values()].map((g) => ({
		month: g.month,
		fromEnvelopeId: g.from,
		toEnvelopeId: g.to,
		amount: g.sum.toFixed(),
	}));
}
