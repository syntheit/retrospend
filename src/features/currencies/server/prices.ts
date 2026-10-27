import "server-only";

import { Decimal } from "@prisma/client/runtime/index-browser";
import { isCrypto } from "@retrospend/domain/currency-format";
import { currencyDecimals } from "@retrospend/domain/money";
import { type Money, money, toMinor } from "@retrospend/domain/money-minor";
import { MARKET, type Rate } from "../types";
import { defaultRateType } from "./rate-default-seam";

/** Exact, half to even, enough digits for any rate times any amount. */
const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
type Dec = InstanceType<typeof Dec>;

/** A row of the rate table: units of the currency per 1 USD (a coin: USD per coin). */
export type RateRow = {
	currency: string;
	type: string;
	rate: { toString(): string };
};

/** Columns in this order first; any other type follows alphabetically. */
const KNOWN = ["official", "blue", "card", "mep", "crypto", "tourist"];
const USD = "USD";

export type Priced = {
	code: string;
	crypto: boolean;
	types: string[];
	/** Units of home per 1 unit of the currency, unrounded (what a conversion multiplies by). */
	prices: Map<string, Dec>;
	/** Units of the currency per 1 unit of home, unrounded (what the page shows). */
	perHome: Map<string, Dec>;
	/**
	 * Types priced through another type's rate because one side has no rate
	 * of that type (BRL at Blue is ARS blue over BRL official).
	 */
	derived: Set<string>;
};

function byType(rows: readonly RateRow[]) {
	const out = new Map<string, Map<string, Dec>>();
	for (const r of rows) {
		const value = new Dec(r.rate.toString());
		if (!value.isFinite() || value.lte(0)) continue;
		const types = out.get(r.currency) ?? new Map<string, Dec>();
		if (!types.has(r.type)) types.set(r.type, value);
		out.set(r.currency, types);
	}
	return out;
}

const order = (types: Iterable<string>) =>
	[...new Set(types)].sort((a, b) => {
		const ia = KNOWN.indexOf(a);
		const ib = KNOWN.indexOf(b);
		if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
		return a.localeCompare(b);
	});

/**
 * Prices every currency in the home currency, per rate type. A fiat pair
 * offers every type either side has; each side uses that type when it has
 * it, else its own default (so "Blue" for EUR reads ARS blue over EUR
 * official); such a price is marked derived. A coin is priced at its
 * market price over the home's default type. A side with no rate at all
 * prices nothing: nothing is ever priced at 1 for want of a rate.
 */
export function priceAll(rows: readonly RateRow[], home: string): Priced[] {
	const table = byType(rows);
	const homeRates =
		home === USD ? new Map([["official", new Dec(1)]]) : table.get(home);
	if (!homeRates) return [];
	const homeTypes = home === USD ? [] : [...homeRates.keys()];
	const homeAt = (type: string) =>
		home === USD
			? new Dec(1)
			: (homeRates.get(type) ??
				homeRates.get(defaultRateType(homeTypes) ?? ""));
	const codes = [...table.keys(), ...(home === USD ? [] : [USD])].filter(
		(c) => c !== home,
	);
	return [...new Set(codes)].flatMap((code): Priced[] => {
		if (isCrypto(code)) {
			const usd = table.get(code)?.get("crypto");
			const h = homeAt(defaultRateType(homeTypes) ?? "");
			if (!usd || !h) return [];
			return [
				{
					code,
					crypto: true,
					types: [MARKET],
					prices: new Map([[MARKET, usd.mul(h)]]),
					perHome: new Map([[MARKET, new Dec(1).div(usd.mul(h))]]),
					derived: new Set<string>(),
				},
			];
		}
		const own =
			code === USD ? new Map<string, Dec>() : (table.get(code) ?? new Map());
		const ownDefault = own.get(defaultRateType([...own.keys()]) ?? "");
		const types = order([...own.keys(), ...homeTypes]);
		const prices = new Map<string, Dec>();
		const perHome = new Map<string, Dec>();
		const derived = new Set<string>();
		for (const type of types) {
			const h = homeAt(type);
			const c = code === USD ? new Dec(1) : (own.get(type) ?? ownDefault);
			if (!h || !c) continue;
			prices.set(type, h.div(c));
			perHome.set(type, c.div(h));
			const homeHas = home === USD || homeRates.has(type);
			if (!homeHas || (code !== USD && !own.has(type))) derived.add(type);
		}
		return prices.size
			? [{ code, crypto: false, types, prices, perHome, derived }]
			: [];
	});
}

/** Every column any row has, in the shared order, coins' market price last. */
export function columnsOf(priced: readonly Priced[]): string[] {
	const fiat = order(priced.filter((p) => !p.crypto).flatMap((p) => p.types));
	return priced.some((p) => p.crypto) ? [...fiat, MARKET] : fiat;
}

/** An unrounded amount as Money, rounded half to even to the currency's minor unit. */
export function toMoney(value: Dec, currency: string): Money {
	// toString may use the exponent form; toMinor reads it exactly.
	const fixed = value.toDecimalPlaces(currencyDecimals(currency)).toString();
	return money(toMinor(fixed, currency), currency);
}

/**
 * A rate as Money in `currency`, with enough decimals to read: the
 * currency's own, extended until two significant digits show (1 ARS is
 * USD 0.00064, not 0.00), up to six more for a fiat and up to 8 for a coin
 * (BTC 0.00001493). `places` says what `minor` counts, so the client
 * formats it without computing anything.
 */
export function toRate(value: Dec, currency: string): Rate {
	const own = currencyDecimals(currency);
	const limit = isCrypto(currency) ? Math.max(own, 8) : own + 6;
	let places = own;
	// Two digits show once the rounded value reaches 10^(1 - places).
	while (
		places < limit &&
		value.toDecimalPlaces(places).lt(new Dec(10).pow(1 - places))
	)
		places++;
	const minor = value
		.mul(new Dec(10).pow(places))
		.toDecimalPlaces(0)
		.toNumber();
	return { ...money(minor, currency), places };
}

/** Minor units of `currency` as an exact decimal amount. */
export function fromMinorDec(minor: number, currency: string): Dec {
	return new Dec(minor).div(new Dec(10).pow(currencyDecimals(currency)));
}

export { Dec };
