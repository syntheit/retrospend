import "server-only";

import { isCrypto } from "@retrospend/domain/currency-format";
import type {
	ConvertDirection,
	ConvertResult,
	CurrenciesView,
	CurrencyRow,
} from "../types";
import {
	columnsOf,
	fromMinorDec,
	type Priced,
	priceAll,
	type RateRow,
	toMoney,
	toRate,
} from "./prices";
import { CAN_SET_DEFAULT, defaultRateType } from "./rate-default-seam";

export type CurrenciesInput = {
	home: string;
	rates: readonly (RateRow & { id: string })[];
	/** Favorite exchange rate rows of the user. */
	favorites: readonly { id: string; currency: string }[];
	/** Open accounts, for the missing-rate rows and notice. */
	accounts: readonly { name: string; currency: string }[];
	updated: string | null;
};

function row(p: Priced, input: CurrenciesInput): CurrencyRow {
	const favs = input.favorites.filter((f) => f.currency === p.code);
	const own = input.rates.filter((r) => r.currency === p.code);
	return {
		code: p.code,
		crypto: p.crypto,
		types: p.types,
		prices: Object.fromEntries(
			[...p.perHome].map(([type, v]) => [type, toRate(v, p.code)]),
		),
		derived: p.types.filter((type) => p.derived.has(type)),
		defaultType: p.crypto ? (p.types[0] ?? null) : defaultRateType(p.types),
		favorite: favs.length > 0,
		rateId:
			(
				own.find((r) => r.type === defaultRateType(own.map((o) => o.type))) ??
				own[0]
			)?.id ?? null,
		favoriteIds: favs.map((f) => f.id),
		usedBy: input.accounts
			.filter((a) => a.currency === p.code)
			.map((a) => a.name),
	};
}

/** A currency an open account uses but the rate table lacks: shown as missing. */
function missingRow(code: string, input: CurrenciesInput): CurrencyRow {
	return {
		code,
		crypto: isCrypto(code),
		types: [],
		prices: {},
		derived: [],
		defaultType: null,
		favorite: false,
		rateId: null,
		favoriteIds: [],
		usedBy: input.accounts
			.filter((a) => a.currency === code)
			.map((a) => a.name),
	};
}

/** Favorites first, then currencies with a rate, then by code. */
const rank = (a: CurrencyRow, b: CurrencyRow) =>
	Number(b.favorite) - Number(a.favorite) ||
	Number(b.types.length > 0) - Number(a.types.length > 0) ||
	a.code.localeCompare(b.code);

export function buildCurrenciesView(input: CurrenciesInput): CurrenciesView {
	const priced = priceAll(input.rates, input.home);
	const rows = priced.map((p) => row(p, input));
	const known = new Set([input.home, ...rows.map((r) => r.code)]);
	const missing = [...new Set(input.accounts.map((a) => a.currency))]
		.filter((c) => !known.has(c))
		.map((c) => missingRow(c, input));
	const homeTypes = input.rates
		.filter((r) => r.currency === input.home)
		.map((r) => r.type);
	return {
		home: input.home,
		columns: columnsOf(priced),
		rows: [...rows, ...missing].sort(rank),
		updated: input.updated,
		homeDefault: defaultRateType(homeTypes),
		canSetDefault: CAN_SET_DEFAULT,
	};
}

/**
 * Converts a typed amount at every rate type of a currency, on the server
 * (R9): to the home currency (amount x price) or from it (amount / price),
 * rounded half to even to the target's minor unit.
 */
export function convert(
	rates: readonly RateRow[],
	home: string,
	code: string,
	minor: number,
	direction: ConvertDirection,
): ConvertResult {
	const p = priceAll(rates, home).find((x) => x.code === code);
	if (!p) return [];
	const from = direction === "toHome" ? code : home;
	const to = direction === "toHome" ? home : code;
	const amount = fromMinorDec(minor, from);
	return [...p.prices].map(([type, price]) => ({
		type,
		value: toMoney(
			direction === "toHome" ? amount.mul(price) : amount.div(price),
			to,
		),
		derived: p.derived.has(type),
	}));
}
