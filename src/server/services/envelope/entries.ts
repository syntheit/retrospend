/**
 * Loaded rows to engine entries: each row valued once in the book currency
 * H (valuation.ts) and dated by the calendar date the person saw in the
 * book's zone (SPEC §5.1, C21). A row without a rate is left out of every
 * sum and listed (C18), never valued at 1.
 */
import { isCrypto } from "~/lib/currency-format";
import { USD } from "~/lib/money";
import type { Prisma } from "~prisma";
import type { ActivityEntry, MoneyInEntry, MovementEntry } from "./engine";
import { budgetMonthOf, isoDateIn, type MonthBoundary } from "./months";
import type { IsoDate, Minor, MissingRate, MonthKey } from "./types";
import { dec, toMinor } from "./units";
import { type ValuationContext, valueRow } from "./valuation";

interface ValuedRow {
	id: string;
	amount: Prisma.Decimal;
	currency: string;
	amountInUSD: Prisma.Decimal | string | null;
	/** The home value booked at save (M2): frozen, used when it is in H. */
	homeCurrency?: string | null;
	homeAmount?: Prisma.Decimal | null;
}

export interface ExpenseRow extends ValuedRow {
	date: Date;
	categoryId: string | null;
	recurringTemplateId: string | null;
	direction: "IN" | "OUT";
	entryKind: "STANDARD" | "STARTING_BALANCE" | "ADJUSTMENT" | "NOT_SPENDING";
}

export interface ShareRow {
	id: string;
	shareAmount: Prisma.Decimal;
	verificationStatus: string;
	transaction: {
		currency: string;
		date: Date;
		categoryId: string | null;
		exchangeRate: Prisma.Decimal | null;
		projectId: string | null;
		category: { userId: string } | null;
	};
}

/** Where a share lands: your own category (D19) or the envelope its project routes to (D31). */
export interface ShareRouting {
	categoryOf: (share: ShareRow) => string | null;
	envelopeOf: (share: ShareRow) => string | null;
}

export interface GroupedMovement {
	month: number;
	fromEnvelopeId: string | null;
	toEnvelopeId: string | null;
	_sum: { amount: Prisma.Decimal | null };
}

/** A foreign row's frozen value is keyed by what it was valued from: an edit values it again. */
export const frozenKey = (r: ValuedRow, date: IsoDate) =>
	`${r.id}|${r.currency}|${r.amount.toString()}|${date}`;

/**
 * Dates rows in the book zone and values them in H, collecting missing
 * rates. A row's value never changes after entry (02 §3.4): a row in H
 * counts as entered, a home value booked at save in H is used as booked, and
 * any other row is valued once at a rate dated on or before it and then
 * frozen (`frozen`, persisted from `fresh` by the loader). Rates are updated
 * in place every day, so valuing again later would use today's rate; a row
 * with no frozen value and no rate dated on or before it is a missing rate.
 */
export class Valuer {
	readonly missingRates: MissingRate[] = [];
	/** Values made by this load, to freeze. */
	readonly fresh: Array<{ key: string; minor: Minor }> = [];

	constructor(
		private readonly ctx: ValuationContext,
		private readonly tz: string,
		private readonly periods: readonly MonthBoundary[],
		private readonly frozen: ReadonlyMap<string, Minor> = new Map(),
	) {}

	dated(d: Date): { date: IsoDate; month: MonthKey } {
		const date = isoDateIn(d, this.tz);
		return { date, month: budgetMonthOf(date, this.periods) };
	}

	/** The budget month of a calendar date (a @db.Date column, read as stored). */
	monthOf(date: IsoDate): MonthKey {
		return budgetMonthOf(date, this.periods);
	}

	value(r: ValuedRow, date: IsoDate, month: MonthKey): Minor | null {
		const H = this.ctx.bookCurrency;
		if (r.currency !== H && r.homeCurrency === H && r.homeAmount != null)
			return toMinor(r.homeAmount.toString(), H);
		const key = frozenKey(r, date);
		const kept = r.currency === H ? undefined : this.frozen.get(key);
		if (kept !== undefined) return kept;
		const v = valueRow(
			{
				id: r.id,
				amount: r.amount.toString(),
				currency: r.currency,
				date,
				month,
				amountInUSD: r.amountInUSD?.toString() ?? null,
			},
			this.ctx,
		);
		if (!v.ok) {
			this.missingRates.push(v.missing);
			return null;
		}
		if (v.source === "BOOK_RATE") this.fresh.push({ key, minor: v.minor });
		return v.minor;
	}
}

const SOURCE = {
	STANDARD: "INCOME",
	STARTING_BALANCE: "STARTING_BALANCE",
	ADJUSTMENT: "ADJUSTMENT",
	NOT_SPENDING: "ADJUSTMENT",
} as const;

/** Income, the starting balance and adjustments (an OUT adjustment lowers To assign). */
export function moneyInEntries(
	rows: readonly ExpenseRow[],
	v: Valuer,
): MoneyInEntry[] {
	const out: MoneyInEntry[] = [];
	for (const r of rows) {
		const { date, month } = v.dated(r.date);
		const minor = v.value(r, date, month);
		if (minor === null) continue;
		out.push({
			id: r.id,
			month,
			minor: r.direction === "OUT" ? -minor : minor,
			source: SOURCE[r.entryKind],
		});
	}
	return out;
}

/** The USD value of a share at the rate its expense captured, else the table rate (units per USD; crypto USD per coin). */
export function shareUsd(
	amount: Prisma.Decimal,
	rate: string | null,
	currency: string,
) {
	if (currency === USD) return amount.toString();
	const r = rate ? dec(rate) : null;
	if (!r || r.lte(0)) return null;
	const a = dec(amount.toString());
	return (isCrypto(currency) ? a.mul(r) : a.div(r)).toString();
}

export interface WealthRow {
	id: string;
	direction: "TO_WEALTH" | "FROM_WEALTH";
	envelopeId: string | null;
	/** A calendar date (@db.Date), read as stored. */
	date: Date;
	/** Book currency. */
	amount: Prisma.Decimal;
}

/**
 * Money moved between the budget and Wealth (D24, SPEC §5.11): into or out
 * of an envelope's Activity, or To assign when no envelope is named.
 */
export function wealthEntries(
	rows: readonly WealthRow[],
	v: Valuer,
	currency: string,
): { moneyIn: MoneyInEntry[]; activity: ActivityEntry[] } {
	const moneyIn: MoneyInEntry[] = [];
	const activity: ActivityEntry[] = [];
	for (const r of rows) {
		const date = r.date.toISOString().slice(0, 10);
		const month = v.monthOf(date);
		const sign = r.direction === "FROM_WEALTH" ? 1 : -1;
		const minor = sign * toMinor(r.amount.toString(), currency);
		if (r.envelopeId)
			activity.push({
				id: r.id,
				month,
				date,
				minor,
				source: "WEALTH",
				categoryId: null,
				envelopeId: r.envelopeId,
			});
		else moneyIn.push({ id: r.id, month, minor, source: "WEALTH" });
	}
	return { moneyIn, activity };
}

/**
 * Spending (negative), refunds (positive) and your shares of splits
 * (negative, pending flagged, D20), each share in your own category (D19)
 * or the envelope its project routes to (D31).
 */
export function activityEntries(
	rows: {
		spending: readonly ExpenseRow[];
		refunds: readonly ExpenseRow[];
		shares: readonly ShareRow[];
		shareRate: (s: ShareRow) => string | null;
	},
	v: Valuer,
	routing: ShareRouting,
): ActivityEntry[] {
	const out: ActivityEntry[] = [];
	const push = (r: ExpenseRow, sign: 1 | -1, source: "SPENT" | "REFUND") => {
		const { date, month } = v.dated(r.date);
		const minor = v.value(r, date, month);
		if (minor === null) return;
		out.push({
			id: r.id,
			month,
			date,
			minor: sign * minor,
			source,
			categoryId: r.categoryId,
			recurring: r.recurringTemplateId !== null,
		});
	};
	for (const r of rows.spending) push(r, -1, "SPENT");
	for (const r of rows.refunds) push(r, 1, "REFUND");
	for (const s of rows.shares) {
		const t = s.transaction;
		const { date, month } = v.dated(t.date);
		const rate = rows.shareRate(s);
		const minor = v.value(
			{
				id: s.id,
				amount: s.shareAmount,
				currency: t.currency,
				amountInUSD: shareUsd(s.shareAmount, rate, t.currency),
			},
			date,
			month,
		);
		if (minor === null) continue;
		out.push({
			id: s.id,
			month,
			date,
			minor: -minor,
			source: "SHARE",
			categoryId: routing.categoryOf(s),
			envelopeId: routing.envelopeOf(s),
			pending: s.verificationStatus === "PENDING",
		});
	}
	return out;
}

export function movementEntries(
	rows: readonly GroupedMovement[],
	currency: string,
): MovementEntry[] {
	return rows.map((g) => ({
		id: `${g.month}:${g.fromEnvelopeId ?? "pool"}:${g.toEnvelopeId ?? "pool"}`,
		month: g.month,
		from: g.fromEnvelopeId,
		to: g.toEnvelopeId,
		minor: toMinor(g._sum.amount?.toString() ?? "0", currency),
	}));
}
