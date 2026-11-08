/**
 * Dates rows in the book zone and values them in H, collecting missing
 * rates. A row's value never changes after entry (02 §3.4):
 *
 * - a row in H counts as entered;
 * - a home value booked at save in H (M2) is used as booked;
 * - any other row is valued once and then frozen (`frozen`, persisted from
 *   `fresh` by the loader): at a rate dated on or before it when there is
 *   one; else, since the sync keeps one rate row per pair dated today, at
 *   the nearest rate there is, flagged approximate ("≈" in the UI);
 * - a pair with no rate at all is a missing rate, never 1.
 *
 * The frozen key holds everything the value depends on, so an edit to the
 * amount, its USD value, the date or the month's rate type values it again.
 */
import type { ValuedRow } from "./entries";
import { budgetMonthOf, isoDateIn, type MonthBoundary } from "./months";
import type { IsoDate, Minor, MissingRate, MonthKey } from "./types";
import { toMinor } from "./units";
import {
	rateTypeForMonth,
	type UsdRateLookup,
	type ValuationContext,
	valueRow,
} from "./valuation";

export const frozenKey = (r: ValuedRow, date: IsoDate, rateType: string) =>
	[
		r.id,
		r.currency,
		r.amount.toString(),
		r.amountInUSD?.toString() ?? "",
		date,
		rateType,
	].join("|");

export interface FrozenValue {
	minor: Minor;
	approximate: boolean;
}

export interface FreshValue extends FrozenValue {
	key: string;
	/** Date of the book-currency rate used; null when none was needed (a USD book). */
	rateDate: IsoDate | null;
}

/** An approximate row: valued at the nearest rate, not one dated on or before it. */
export interface ApproximateRow {
	rowId: string;
	date: IsoDate;
}

export interface NearestRate {
	/** Latest on or before the date, else the earliest after it. */
	usdRate: UsdRateLookup;
	/** The date of the rate `usdRate` gives. */
	rateDate: (
		currency: string,
		rateType: string,
		date: IsoDate,
	) => IsoDate | null;
}

export class Valuer {
	readonly missingRates: MissingRate[] = [];
	readonly approximate: ApproximateRow[] = [];
	/** Values made by this load, to freeze. */
	readonly fresh: FreshValue[] = [];

	constructor(
		private readonly ctx: ValuationContext,
		private readonly tz: string,
		private readonly periods: readonly MonthBoundary[],
		private readonly frozen: ReadonlyMap<string, FrozenValue> = new Map(),
		private readonly nearest: NearestRate | null = null,
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
		const row = {
			id: r.id,
			amount: r.amount.toString(),
			currency: r.currency,
			date,
			month,
			amountInUSD: r.amountInUSD?.toString() ?? null,
		};
		if (r.currency === H) return this.settle(valueRow(row, this.ctx));
		const rateType = rateTypeForMonth(month, this.ctx);
		const key = frozenKey(r, date, rateType);
		const kept = this.frozen.get(key);
		if (kept) {
			if (kept.approximate) this.approximate.push({ rowId: r.id, date });
			return kept.minor;
		}
		let v = valueRow(row, this.ctx);
		let approximate = false;
		if (!v.ok && this.nearest && v.missing.currency === H) {
			const near = valueRow(row, {
				...this.ctx,
				usdRate: this.nearest.usdRate,
			});
			if (near.ok) {
				v = near;
				approximate = true;
			}
		}
		if (v.ok && v.source === "BOOK_RATE") {
			const rateDate =
				v.rateType && this.nearest
					? this.nearest.rateDate(H, v.rateType, date)
					: null;
			this.fresh.push({ key, minor: v.minor, approximate, rateDate });
			if (approximate) this.approximate.push({ rowId: r.id, date });
		}
		return this.settle(v);
	}

	private settle(v: ReturnType<typeof valueRow>): Minor | null {
		if (v.ok) return v.minor;
		this.missingRates.push(v.missing);
		return null;
	}
}
