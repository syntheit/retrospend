import { isCrypto } from "@retrospend/domain/currency-format";
import {
	HISTORY_RANGES,
	type HistoryPoint,
	type HistoryRange,
	type HistorySeries,
	MARKET,
	type RateHistory,
} from "../types";
import { Dec, order, placesFor, toRateAt } from "./prices";
import { defaultRateType } from "./rate-default-seam";

/** A stored rate of one day: units of the currency per 1 USD (a coin: USD per coin). */
export type HistoryRow = {
	currency: string;
	type: string;
	/** ISO day. */
	day: string;
	rate: { toString(): string };
};

const USD = "USD";

/** Days back from today, per range; ALL has no start. */
const RANGE_DAYS: Record<HistoryRange, number | null> = {
	"1M": 30,
	"3M": 91,
	"1Y": 365,
	ALL: null,
};

export const isHistoryRange = (v: string): v is HistoryRange =>
	(HISTORY_RANGES as readonly string[]).includes(v);

/** The first day a range shows, or null for every stored day. */
export function rangeStart(range: HistoryRange, today: string): string | null {
	const days = RANGE_DAYS[range];
	if (days === null) return null;
	const start = new Date(`${today}T00:00:00Z`);
	start.setUTCDate(start.getUTCDate() - days);
	return start.toISOString().slice(0, 10);
}

/** A rate type's days, oldest first. A constant (USD is 1) is a single Dec. */
type Track = { day: string; value: Dec }[];
type Source = Track | Dec;

function tracksOf(rows: readonly HistoryRow[], currency: string) {
	const byType = new Map<string, Map<string, Dec>>();
	for (const r of rows) {
		if (r.currency !== currency) continue;
		const value = new Dec(r.rate.toString());
		if (!value.isFinite() || value.lte(0)) continue;
		const days = byType.get(r.type) ?? new Map<string, Dec>();
		days.set(r.day, value);
		byType.set(r.type, days);
	}
	return new Map<string, Track>(
		[...byType].map(([type, days]) => [
			type,
			[...days]
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([day, value]) => ({ day, value })),
		]),
	);
}

/** The value in force on each day (the latest on or before it); undefined before the first. */
function sample(source: Source, days: string[]): (Dec | undefined)[] {
	if (!Array.isArray(source)) return days.map(() => source);
	let at = 0;
	let current: Dec | undefined;
	return days.map((day) => {
		while (source[at] && source[at].day <= day) {
			current = source[at]?.value;
			at++;
		}
		return current;
	});
}

/**
 * The days to draw: every day either side has a rate, from `start` on, and
 * always the newest day, so a currency that last synced before the range
 * still shows where it stands.
 */
function daysOf(a: Source, b: Source, start: string | null): string[] {
	const all = new Set<string>();
	for (const s of [a, b])
		if (Array.isArray(s)) for (const p of s) all.add(p.day);
	const sorted = [...all].sort();
	const last = sorted[sorted.length - 1];
	const within = start ? sorted.filter((d) => d >= start) : sorted;
	return within.length || !last ? within : [last];
}

type Raw = {
	type: string;
	derived: boolean;
	/** Units of home per 1 unit of the currency, unrounded. */
	days: { day: string; inHome: Dec }[];
};

const empty = (
	code: string,
	home: string,
	range: HistoryRange,
): RateHistory => ({
	code,
	home,
	range,
	base: null,
	defaultType: null,
	series: [],
});

/**
 * A currency's rate history against the home currency, priced exactly like
 * the Currencies page (priceAll in prices.ts): a fiat pair uses each rate
 * type either side has, an absent type falling back to that side's default;
 * a coin is its market price over the home currency's default type. A day
 * counts once both sides have a rate on or before it, and a side's rate
 * carries forward over days it was not stored. Nothing is ever priced at 1
 * for want of a rate: a side with no rate at all gives no history.
 *
 * Every point is the page's unit (the stronger currency of the pair as of
 * the newest day of the default type) at one number of decimal places, so
 * the line and the types are comparable.
 */
export function buildRateHistory(input: {
	code: string;
	home: string;
	rows: readonly HistoryRow[];
	range: HistoryRange;
	/** ISO day, today in UTC (rates are stored by UTC day). */
	today: string;
}): RateHistory {
	const { code, home, range } = input;
	if (code === home) return empty(code, home, range);
	const start = rangeStart(range, input.today);
	const homeTracks = home === USD ? null : tracksOf(input.rows, home);
	if (home !== USD && !homeTracks?.size) return empty(code, home, range);
	const homeTypes = homeTracks ? [...homeTracks.keys()] : [];
	const homeAt = (type: string): Source | undefined =>
		home === USD
			? new Dec(1)
			: (homeTracks?.get(type) ??
				homeTracks?.get(defaultRateType(homeTypes) ?? ""));

	const raw: Raw[] = [];
	const crypto = isCrypto(code);
	const own =
		code === USD ? new Map<string, Track>() : tracksOf(input.rows, code);
	if (crypto) {
		const usd = own.get("crypto");
		const h = homeAt(defaultRateType(homeTypes) ?? "");
		if (usd && h) {
			const days = daysOf(usd, h, start);
			const u = sample(usd, days);
			const hv = sample(h, days);
			raw.push({
				type: MARKET,
				derived: false,
				days: days.flatMap((day, i) => {
					const a = u[i];
					const b = hv[i];
					return a && b ? [{ day, inHome: a.mul(b) }] : [];
				}),
			});
		}
	} else {
		const ownDefault = own.get(defaultRateType([...own.keys()]) ?? "");
		for (const type of order([...own.keys(), ...homeTypes])) {
			const h = homeAt(type);
			const c: Source | undefined =
				code === USD ? new Dec(1) : (own.get(type) ?? ownDefault);
			if (!h || !c) continue;
			const days = daysOf(c, h, start);
			const cv = sample(c, days);
			const hv = sample(h, days);
			const homeHas = home === USD || (homeTracks?.has(type) ?? false);
			raw.push({
				type,
				derived: !homeHas || (code !== USD && !own.has(type)),
				days: days.flatMap((day, i) => {
					const a = cv[i];
					const b = hv[i];
					return a && b ? [{ day, inHome: b.div(a) }] : [];
				}),
			});
		}
	}

	const series = raw.filter((s) => s.days.length > 0);
	const types = series.map((s) => s.type);
	const defaultType = crypto ? (types[0] ?? null) : defaultRateType(types);
	const ref = series.find((s) => s.type === defaultType) ?? series[0];
	const newest = ref?.days[ref.days.length - 1];
	if (!ref || !newest) return empty(code, home, range);

	// The stronger currency of the pair is the one unit, as the page prices it.
	const unit = newest.inHome.gte(1) ? code : home;
	const priced = series.map((s) => ({
		...s,
		days: s.days.map((d) => ({
			day: d.day,
			value: unit === code ? d.inHome : new Dec(1).div(d.inHome),
		})),
	}));
	const currency = unit === code ? home : code;
	const places = Math.max(
		...priced.flatMap((s) => s.days.map((d) => placesFor(d.value, currency))),
	);
	const out: HistorySeries[] = priced.map((s) => {
		const first = s.days[0]?.value;
		const last = s.days[s.days.length - 1]?.value;
		return {
			type: s.type,
			derived: s.derived,
			changeBp:
				first && last && s.days.length > 1
					? last
							.minus(first)
							.div(first)
							.mul(10000)
							.toDecimalPlaces(0)
							.toNumber()
					: null,
			points: s.days.map(
				(d): HistoryPoint => ({
					date: d.day,
					price: toRateAt(d.value, currency, places),
				}),
			),
		};
	});
	return {
		code,
		home,
		range,
		base: unit,
		defaultType: ref.type,
		series: out,
	};
}
