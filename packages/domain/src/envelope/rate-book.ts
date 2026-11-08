/**
 * Exchange rates for one engine pass, loaded in one query and kept as exact
 * decimal strings (valuation.ts never sees a float). A lookup takes the
 * latest rate on or before the date, else the earliest after it: the app's
 * nearest-rate rule (src/server/exchange-rates.ts). A currency or type with
 * no rows at all has no rate, and the row that needed it is left out.
 */
import { USD } from "../money";
import type { IsoDate } from "./types";
import type { UsdRateLookup } from "./valuation";

/** One stored rate: `rate` is an exact decimal string, `date` the day it applies to. */
export interface RateRow {
	currency: string;
	type: string;
	rate: string;
	date: IsoDate;
	/**
	 * The stored timestamp. A day can hold several rows of one pair (the table
	 * is unique on the timestamp), and the latest wins; leave it out only
	 * when a pair has one row a day.
	 */
	at?: string;
}

export interface RateBookParams {
	bookCurrency: string;
	rateTypes: readonly string[];
	since: IsoDate;
	extraCurrencies?: readonly string[];
}

/** The currencies a book reads rates for: its own and the extras, never USD. */
export function rateBookCurrencies(p: RateBookParams): string[] {
	return [...new Set([p.bookCurrency, ...(p.extraCurrencies ?? [])])].filter(
		(c) => c !== USD,
	);
}

/**
 * Which stored rows a book needs: every rate from `since` on, plus the latest
 * before it per currency and type, so a row dated near `since` whose only
 * earlier rate is older is still valued on or before it. The JS counterpart
 * of the server loader's SQL; both return the rows oldest first.
 */
export function selectRateRows(
	all: Iterable<RateRow>,
	p: RateBookParams,
): RateRow[] {
	const wanted = new Set(rateBookCurrencies(p));
	const anchors = new Map<string, RateRow>();
	const later: RateRow[] = [];
	for (const r of all) {
		if (!wanted.has(r.currency)) continue;
		if (r.date >= p.since) later.push(r);
		else {
			const key = `${r.currency}\0${r.type}`;
			const held = anchors.get(key);
			if (!held || isLater(r, held)) anchors.set(key, r);
		}
	}
	return [...anchors.values(), ...later].sort((x, y) =>
		x.date < y.date
			? -1
			: x.date > y.date
				? 1
				: (x.at ?? "") < (y.at ?? "")
					? -1
					: (x.at ?? "") > (y.at ?? "")
						? 1
						: 0,
	);
}

/** Whether `a` is the later row: by day, then by stored timestamp (SQL: ORDER BY date DESC). */
function isLater(a: RateRow, b: RateRow): boolean {
	return a.date !== b.date ? a.date > b.date : (a.at ?? "") > (b.at ?? "");
}

interface RatePoint {
	date: IsoDate;
	rate: string;
}

function pick(
	points: readonly RatePoint[] | undefined,
	date: IsoDate,
): string | null {
	if (!points || points.length === 0) return null;
	let lo = 0;
	let hi = points.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if ((points[mid] as RatePoint).date <= date) {
			found = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return (points[Math.max(found, 0)] as RatePoint).rate;
}

export class RateBook {
	private constructor(private readonly points: Map<string, RatePoint[]>) {}

	/** Rows already chosen for the book (selectRateRows), oldest first. The book currency keeps only its rate types. */
	static fromRows(rows: Iterable<RateRow>, p: RateBookParams): RateBook {
		const points = new Map<string, RatePoint[]>();
		for (const r of rows) {
			if (r.currency === p.bookCurrency && !p.rateTypes.includes(r.type))
				continue;
			const key = `${r.currency}\0${r.type}`;
			const list = points.get(key) ?? [];
			list.push({ date: r.date, rate: r.rate });
			points.set(key, list);
		}
		return new RateBook(points);
	}

	readonly lookup: UsdRateLookup = (currency, rateType, date) =>
		pick(this.points.get(`${currency}\0${rateType}`), date);

	/**
	 * A rate dated on or before `date`, never a later one: what values a row
	 * once (entries.ts Valuer). The daily sync moves its row forward in place,
	 * so "the earliest after" would be today's rate.
	 */
	readonly onOrBefore: UsdRateLookup = (currency, rateType, date) => {
		const points = this.points.get(`${currency}\0${rateType}`);
		const first = points?.[0];
		if (!first || first.date > date) return null;
		return pick(points, date);
	};

	/** The date of the rate `lookup` gives for `date`, or null when there is none. */
	readonly rateDate = (currency: string, rateType: string, date: IsoDate) => {
		const points = this.points.get(`${currency}\0${rateType}`) ?? [];
		let found: RatePoint | null = points[0] ?? null;
		for (const p of points) if (p.date <= date) found = p;
		return found?.date ?? null;
	};
}
