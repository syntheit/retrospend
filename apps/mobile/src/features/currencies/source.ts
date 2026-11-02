import type { RetrospendClient } from "@retrospend/api-client";
import { parseMoneyInput } from "@retrospend/domain/parse";
import type { CacheKey } from "@/features/read/loadCached";

// The Currencies screen reads API v1's rate table: every price and every
// conversion comes from the server (GET /rates/table, /rates/{code}/convert).
// What is here only picks rows and reads the search field.

export type RateTable = Awaited<
	ReturnType<RetrospendClient["currencies"]["rateTable"]>
>;
export type CurrencyRow = RateTable["rows"][number];
export type RatePrice = NonNullable<CurrencyRow["rates"][number]["price"]>;
export type Conversion = Awaited<
	ReturnType<RetrospendClient["currencies"]["convert"]>
>;
export type ConvertDirection = "toHome" | "fromHome";

export const RATE_TABLE_CACHE: CacheKey = {
	name: "currencies.table",
	schema: 1,
};

export function fetchRateTable(api: RetrospendClient) {
	return () => api.currencies.rateTable();
}

export type CurrencyFilter = "all" | "favorites" | "fiat" | "crypto";
/** The chips on the screen: each one narrows the list, and a second tap clears it. */
export const TOGGLE_FILTERS = ["favorites", "fiat", "crypto"] as const;

/** Case and accents folded, so "real" finds "Real brasileño". */
export function fold(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase();
}

/** A row has a price when the server priced at least one of its types. */
export const priced = (row: CurrencyRow) =>
	row.rates.some((r) => r.price !== null);

/** The price new amounts use, or null with no rate. */
export function defaultPrice(row: CurrencyRow): RatePrice | null {
	if (!row.defaultType) return null;
	return row.rates.find((r) => r.type === row.defaultType)?.price ?? null;
}

/**
 * The rows the list shows, in the server's order: the filter first, then a
 * conversion's currency alone, else the code or name matching the search.
 */
export function visibleRows(
	rows: readonly CurrencyRow[],
	filter: CurrencyFilter,
	query: string,
	name: (code: string) => string,
	conv: ConvQuery | null,
): CurrencyRow[] {
	const q = fold(query.trim());
	return rows.filter((r) => {
		if (filter === "favorites" && !r.favorite) return false;
		if (filter === "fiat" && r.crypto) return false;
		if (filter === "crypto" && !r.crypto) return false;
		if (conv) return r.code === conv.code;
		return !q || fold(`${r.code} ${name(r.code)}`).includes(q);
	});
}

/** Currencies an open account uses that have no rate: they are left out of totals. */
export function missingRows(rows: readonly CurrencyRow[]): CurrencyRow[] {
	return rows.filter((r) => !priced(r) && r.usedBy.length > 0);
}

export type ConvQuery = {
	code: string;
	from: string;
	to: string;
	minor: number;
	direction: ConvertDirection;
};

const QUERY =
	/^\s*([\d.,\s]+?)\s*([a-z]{3,5})(?:\s+(?:to|in|en|a|para|nach|vers|в)\s+([a-z]{3,5}))?\s*$/i;

/**
 * Reads "100 usd", "100 usd to ars" or "50000 ars in brl" from the search
 * field, the same reading the web page does. One side must be the home
 * currency (the server converts through it) and the other must have a
 * rate. Null for anything else: the field is then a plain search.
 */
export function readConvQuery(
	text: string,
	home: string,
	rows: readonly CurrencyRow[],
	locale: string,
): ConvQuery | null {
	const m = QUERY.exec(text);
	if (!m?.[1] || !m[2]) return null;
	const from = m[2].toUpperCase();
	const to = m[3]?.toUpperCase() ?? (from === home ? null : home);
	if (!to || from === to || (from !== home && to !== home)) return null;
	const code = from === home ? to : from;
	if (!rows.some((r) => r.code === code && priced(r))) return null;
	const amount = parseMoneyInput(m[1].trim(), locale, from);
	if (!amount.ok) return null;
	return {
		code,
		from,
		to,
		minor: amount.minor,
		direction: from === home ? "fromHome" : "toHome",
	};
}

/** The rate types the app names; any other reads as its own key, capitalized. */
export const KNOWN_RATE_TYPES = [
	"official",
	"blue",
	"card",
	"mep",
	"crypto",
	"tourist",
	"market",
	"custom",
] as const;

export function rateTypeKey(
	type: string,
): (typeof KNOWN_RATE_TYPES)[number] | null {
	return (KNOWN_RATE_TYPES as readonly string[]).includes(type)
		? (type as (typeof KNOWN_RATE_TYPES)[number])
		: null;
}

/** The pins a star change sends: the default rate to pin, or every pin to remove. */
export function pinChange(
	row: CurrencyRow,
	on: boolean,
): { add: string[]; remove: string[] } {
	if (on) return { add: row.rateId ? [row.rateId] : [], remove: [] };
	return { add: [], remove: row.favoriteIds };
}
