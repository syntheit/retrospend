/**
 * Booking an entry's rate, once, for the server and the device. An entry's
 * rate has two legs: the entry leg (exchangeRate, amountInUSD, in the stored
 * per-USD convention) and the home leg booked once (rateType, homeCurrency,
 * homeRate, homeAmount), so the entry never drifts with later rates.
 *
 * - `rateChoice` decides how a form's rate input is booked (pure).
 * - `bookRate` books it: the cross rate (units of home per 1 unit of the
 *   entry currency, 12 decimals, half-even) and the home amount it gives
 *   (home minor units, half-even), in Decimal math. A rate that is not there
 *   throws MissingRateError; it is never 0 or 1.
 *
 * Rates come from a `find` the caller supplies, which may be async: the
 * server reads its table, a device its store. Everything else is shared.
 * Bad input throws RateInputError, which each caller maps to its own error.
 */
import { isCrypto } from "./currency-format";
import {
	computeAmountInUSD,
	currencyDecimals,
	isValidRate,
	MissingRateError,
	type PickedRate,
	rateFromUsdPerUnit,
	USD,
} from "./money";
import { Dec, type Decimal, dec } from "./precise-decimal";

/** The input is wrong (a rate to type, a rate above zero), not a rate missing. */
export class RateInputError extends Error {
	override readonly name = "RateInputError";
}

// ── Rate types ───────────────────────────────────────────────────────────────

/** A rate the user typed in by hand. */
export const CUSTOM_RATE_TYPE = "custom";

/** Built-in default per home currency, until the user picks one (N73). */
export const HOME_DEFAULT_RATE_TYPES: Readonly<Record<string, string>> = {
	ARS: "blue",
};

/** Table rate types are lower-case keys (the sidecar's validType). */
const RATE_TYPE_KEY = /^[a-z0-9_-]{1,32}$/;
const CURRENCY_KEY = /^[A-Z0-9]{3,10}$/;

/**
 * pricingSource values that name no rate type: what the server, imports and
 * recurring posts write when no type was given.
 */
const PLACEHOLDER_SOURCES = new Set(
	"manual import imported recurring".split(" "),
);

export function isRateTypeKey(value: unknown): value is string {
	return typeof value === "string" && RATE_TYPE_KEY.test(value);
}

/** The saved defaults, keeping only well-formed pairs (the column is free JSON). */
export function parseRateDefaults(raw: unknown): Record<string, string> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	return Object.fromEntries(
		Object.entries(raw).filter(
			([home, type]) =>
				CURRENCY_KEY.test(home) &&
				isRateTypeKey(type) &&
				type !== CUSTOM_RATE_TYPE,
		),
	) as Record<string, string>;
}

/** The user's preferred type for conversions into `homeCurrency`, or null for none. */
export function preferredRateType(
	homeCurrency: string,
	saved: Readonly<Record<string, string>>,
): string | null {
	return saved[homeCurrency] ?? HOME_DEFAULT_RATE_TYPES[homeCurrency] ?? null;
}

/**
 * The rate type a legacy pricingSource names (the M2 backfill uses the same
 * rule in SQL). Placeholders and free text from imports name none.
 */
export function rateTypeFromPricingSource(
	source: string | null | undefined,
): string | null {
	const key = source?.trim().toLowerCase() ?? "";
	if (PLACEHOLDER_SOURCES.has(key)) return null;
	return isRateTypeKey(key) ? key : null;
}

// ── Choosing ─────────────────────────────────────────────────────────────────

function sameRate(a: number, b: number): boolean {
	return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 1e-6;
}

/** What the form sends about an entry's rate. */
export interface RateInput {
	amount: number | string;
	currency: string;
	date: Date;
	/** Entry leg in the stored convention: kept when custom or unchanged on edit. */
	exchangeRate?: number;
	/** Legacy: the entry leg's rate type, or a placeholder (MANUAL, IMPORT). */
	pricingSource?: string | null;
	/** The pair's rate type picked on the Add sheet (a table type or "custom"). */
	rateType?: string;
	/** A typed rate: 1 `base` = `value` of the other; `home` pins an undo's home. */
	customRate?: { base: string; value: string; home?: string };
}

/** The rate an expense was saved with. */
export interface SavedRate {
	currency: string;
	exchangeRate: number;
	rateType: string | null;
	homeCurrency: string | null;
	homeRate: string | null;
}

/** Editing without touching the rate: same currency, same rate, same type. */
function untouched(input: RateInput, saved: SavedRate): boolean {
	return (
		saved.currency === input.currency &&
		isValidRate(saved.exchangeRate) &&
		(input.exchangeRate === undefined ||
			sameRate(input.exchangeRate, saved.exchangeRate)) &&
		(input.rateType === undefined || input.rateType === saved.rateType)
	);
}

/** How the rate of an entry is chosen. */
export type RateChoice =
	/**
	 * Both legs from the rate table, of this type (null: the user's default).
	 * `entryType` is the old form's pricingSource: it named the entry leg's
	 * type only, so it never reaches the home leg.
	 */
	| { kind: "table"; rateType: string | null; entryType?: string | null }
	/** The entry leg is given (a typed or kept rate); the home leg comes from the table. */
	| { kind: "entryLeg"; exchangeRate: number; rateType: string | null }
	/** Both legs kept from the saved row. */
	| {
			kind: "kept";
			exchangeRate: number;
			homeRate: string;
			rateType: string | null;
	  }
	/** A typed rate as decimal text: 1 `base` = `value` of the other currency. */
	| { kind: "custom"; base: string; value: string };

/**
 * How an entry's rate is chosen (pure, so every rule is unit tested):
 * - a typed cross rate (the Add sheet's Custom) wins;
 * - an edit that leaves the rate alone keeps both legs (its home leg when it
 *   was booked in today's home, else the home leg is booked now);
 * - the old form's custom rate keeps its entry leg;
 * - anything else comes from the table for the entry date, of the picked
 *   type on both legs. Without one, the old form's pricingSource picks the
 *   entry leg only (it sends "official" for EUR and BRL on its own, and
 *   "official" for USD, whose leg has no type) and the home leg takes the
 *   user's default.
 */
export function rateChoice(
	input: RateInput,
	saved: SavedRate | null | undefined,
	homeCurrency: string,
): RateChoice {
	if (input.customRate) return { kind: "custom", ...input.customRate };
	const legacyType = rateTypeFromPricingSource(input.pricingSource);
	if (saved && untouched(input, saved)) {
		if (saved.homeCurrency === homeCurrency && saved.homeRate) {
			return {
				kind: "kept",
				exchangeRate: saved.exchangeRate,
				homeRate: saved.homeRate,
				rateType: saved.rateType,
			};
		}
		return {
			kind: "entryLeg",
			exchangeRate: saved.exchangeRate,
			rateType: saved.rateType ?? legacyType,
		};
	}
	const entryType = input.currency === USD ? null : legacyType;
	if ((input.rateType ?? entryType) === CUSTOM_RATE_TYPE) {
		if (input.currency !== USD && isValidRate(input.exchangeRate)) {
			return {
				kind: "entryLeg",
				exchangeRate: input.exchangeRate,
				rateType: CUSTOM_RATE_TYPE,
			};
		}
		throw new RateInputError("Enter the custom rate");
	}
	if (input.rateType !== undefined) {
		return { kind: "table", rateType: input.rateType };
	}
	return { kind: "table", rateType: null, entryType };
}

// ── Booking ──────────────────────────────────────────────────────────────────

/** The best rate of a currency on a date; null only for a currency with no rate at all. */
export type RateFinder = (
	currency: string,
	date: Date,
	preferredType: string | null,
) => PickedRate | null | Promise<PickedRate | null>;

export interface BookContext {
	homeCurrency: string;
	/** The user's preferred type for conversions into their home, or null. */
	preferred: string | null;
	find: RateFinder;
}

/** An entry's rate, both legs, as stored on the expense row. */
export interface BookedRate {
	exchangeRate: number;
	amountInUSD: number;
	rateType: string | null;
	homeCurrency: string;
	/** Units of homeCurrency per 1 unit of the entry currency, as a decimal string. */
	homeRate: string;
	/** The booked home amount, at home minor units, as a decimal string. */
	homeAmount: string;
}

export interface EntryAmount {
	/** A decimal string keeps a typed amount exact (a transfer fee). */
	amount: number | string;
	currency: string;
	date: Date;
}

/** Scale of expense.homeRate (DECIMAL(28,12)). */
const HOME_RATE_DECIMALS = 12;

interface Leg {
	rate: number;
	/** The table type used; empty for USD, whose rate is always 1. */
	type: string;
}

async function legOf(
	ctx: BookContext,
	currency: string,
	date: Date,
	rateType: string | null,
): Promise<Leg> {
	if (currency === USD) return { rate: 1, type: "" };
	const picked = await ctx.find(currency, date, rateType);
	if (!picked) throw new MissingRateError(currency);
	return { rate: picked.rate, type: picked.type };
}

/** USD value of one unit of `currency` at its stored-convention rate. */
function usdPerUnit(currency: string, rate: number): Decimal {
	if (currency === USD) return new Dec(1);
	return isCrypto(currency) ? new Dec(rate) : new Dec(1).div(new Dec(rate));
}

const roundRate = (value: Decimal) =>
	value.toDecimalPlaces(HOME_RATE_DECIMALS, Dec.ROUND_HALF_EVEN);

/**
 * The type a booked rate is labeled with: the requested one when a leg used
 * it, else the first leg's type that is not Official (home leg first, as
 * payments label their quotes), else Official. Null with no table leg (USD
 * to USD). It never claims a type no leg used.
 */
function labelFor(
	requested: string | null,
	legs: readonly Leg[],
): string | null {
	const types = legs.map((leg) => leg.type).filter(Boolean);
	if (requested && types.includes(requested)) return requested;
	return types.find((t) => t !== "official") ?? types[0] ?? null;
}

/**
 * The stored row for a cross rate. The home amount comes from the exact
 * rate, not its 12-decimal copy: a tiny rate (ARS into a BTC home) keeps too
 * few digits at 12 decimals for amounts in the millions.
 */
function booked(
	entry: EntryAmount,
	ctx: BookContext,
	exchangeRate: number,
	exactRate: Decimal,
	rateType: string | null,
): BookedRate {
	const decimals = currencyDecimals(ctx.homeCurrency);
	return {
		exchangeRate,
		// The legacy USD column is a rounded float either way.
		amountInUSD: computeAmountInUSD(
			Number(entry.amount),
			entry.currency,
			exchangeRate,
		),
		rateType,
		homeCurrency: ctx.homeCurrency,
		homeRate: roundRate(exactRate).toFixed(),
		homeAmount: dec(entry.amount)
			.mul(exactRate)
			.toDecimalPlaces(decimals, Dec.ROUND_HALF_EVEN)
			.toFixed(decimals),
	};
}

/** Home leg for an entry leg: the same currency is 1, a USD home needs no table rate. */
async function homeRateFor(
	ctx: BookContext,
	entry: EntryAmount,
	entryLeg: Leg,
	rateType: string | null,
): Promise<{ homeRate: Decimal; legs: Leg[] }> {
	const home = ctx.homeCurrency;
	if (home === entry.currency) {
		return { homeRate: new Dec(1), legs: [entryLeg] };
	}
	const homeLeg = await legOf(ctx, home, entry.date, rateType ?? ctx.preferred);
	const homeRate = usdPerUnit(entry.currency, entryLeg.rate).div(
		usdPerUnit(home, homeLeg.rate),
	);
	return { homeRate, legs: [homeLeg, entryLeg] };
}

/** A typed cross rate; the entry leg is derived from it through the home leg's table rate. */
async function bookCustom(
	ctx: BookContext,
	entry: EntryAmount,
	choice: { base: string; value: string },
): Promise<BookedRate> {
	const home = ctx.homeCurrency;
	if (
		entry.currency === home ||
		![entry.currency, home].includes(choice.base)
	) {
		throw new RateInputError(
			`A custom rate converts ${entry.currency} to ${home}`,
		);
	}
	if (!/^(?=.*[1-9])\d+(\.\d+)?$/.test(choice.value)) {
		throw new RateInputError("Enter a rate above 0");
	}
	const typed = new Dec(choice.value);
	const perUnit =
		choice.base === entry.currency ? typed : new Dec(1).div(typed);
	const homeLeg = await legOf(ctx, home, entry.date, ctx.preferred);
	// The entry leg comes from the typed rate itself, not its rounded copy.
	const usd = perUnit.mul(usdPerUnit(home, homeLeg.rate));
	const exchangeRate = rateFromUsdPerUnit(entry.currency, usd.toNumber());
	return booked(entry, ctx, exchangeRate, perUnit, CUSTOM_RATE_TYPE);
}

/** Books an entry's rate under `choice` (see RateChoice). */
export async function bookRate(
	ctx: BookContext,
	entry: EntryAmount,
	choice: RateChoice,
): Promise<BookedRate> {
	switch (choice.kind) {
		case "custom":
			return bookCustom(ctx, entry, choice);
		case "kept":
			return booked(
				entry,
				ctx,
				choice.exchangeRate,
				new Dec(choice.homeRate),
				choice.rateType,
			);
		case "entryLeg": {
			const custom = choice.rateType === CUSTOM_RATE_TYPE;
			const entryLeg = {
				rate: choice.exchangeRate,
				type: custom || entry.currency === USD ? "" : (choice.rateType ?? ""),
			};
			// A kept or typed entry leg says nothing about the home leg's type: the default applies.
			const { homeRate, legs } = await homeRateFor(ctx, entry, entryLeg, null);
			const rateType = custom ? CUSTOM_RATE_TYPE : labelFor(null, legs);
			return booked(entry, ctx, choice.exchangeRate, homeRate, rateType);
		}
		case "table": {
			const type = choice.rateType ?? ctx.preferred;
			const entryType = choice.rateType ?? choice.entryType ?? ctx.preferred;
			const entryLeg = await legOf(ctx, entry.currency, entry.date, entryType);
			const { homeRate, legs } = await homeRateFor(ctx, entry, entryLeg, type);
			return booked(entry, ctx, entryLeg.rate, homeRate, labelFor(type, legs));
		}
	}
}
