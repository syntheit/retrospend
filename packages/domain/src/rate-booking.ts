/**
 * Booking an entry's rate, once, for the server and the device. An entry's
 * rate has two legs: the entry leg (exchangeRate, amountInUSD, in the stored
 * per-USD convention) and the home leg booked once (rateType, homeCurrency,
 * homeRate, homeAmount), so the entry never drifts with later rates.
 *
 * - `rateChoice` decides how a form's rate input is booked (pure).
 * - `bookRate` books it: the cross rate (units of home per 1 unit of the
 *   entry currency, 12 decimals, half-even), the home amount it gives (home
 *   minor units, half-even) and the USD value (cents, half-even), in Decimal
 *   math, each one division of exact products. A rate that is not there
 *   throws MissingRateError; it is never 0 or 1. An edit that moves no money
 *   keeps the figures it was saved with.
 *
 * Rates come from a `find` the caller supplies, which may be async: the
 * server reads its table, a device its store. Everything else is shared.
 * Bad input throws RateInputError, which each caller maps to its own error.
 */
import { isCrypto } from "./currency-format";
import {
	currencyDecimals,
	isValidRate,
	MissingRateError,
	type PickedRate,
	USD,
} from "./money";
import {
	roundMoneyDec,
	roundRateDec,
	roundUSDDec,
	usdFractionDec,
} from "./money-dec";
import { Dec, type Decimal, type DecimalInput, dec } from "./precise-decimal";

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
/** A currency code as the rate table and the forms keep it. */
export const CURRENCY_KEY = /^[A-Z0-9]{3,10}$/;

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

/** The rate an expense was saved with, and the money it booked (decimal text). */
export interface SavedRate {
	currency: string;
	exchangeRate: number;
	rateType: string | null;
	homeCurrency: string | null;
	homeRate: string | null;
	amount: string;
	date: Date;
	amountInUSD: string;
	homeAmount: string | null;
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
	/**
	 * The entry leg is the entry's USD value (a file's USD column): USD per
	 * unit is exactly `usd` / amount, so amountInUSD is `usd` to cents and
	 * no rounded rate stands between them. The home leg comes from the table.
	 */
	| { kind: "usdValue"; usd: DecimalInput }
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

/**
 * An entry's rate, both legs, as stored on the expense row. Every figure is
 * decimal text already at its column's scale, rounded half to even, so
 * Postgres never rounds it again.
 */
export interface BookedRate {
	/** The entry leg in the stored convention, at 6 decimals. */
	exchangeRate: string;
	/** The entry in USD, to cents. */
	amountInUSD: string;
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

/** Scale of expense.amount (DECIMAL(19,8)). */
const AMOUNT_DECIMALS = 8;
/** Scale of expense.exchangeRate (DECIMAL(18,6)). */
const EXCHANGE_RATE_DECIMALS = 6;
/** Scale of expense.homeRate (DECIMAL(28,12)). */
const HOME_RATE_DECIMALS = 12;

/**
 * An amount as expense.amount stores it: 8 decimals, half to even. Writers
 * store and book this text, so Postgres never rounds it (half away from
 * zero) and the server and the device store the same row.
 */
export function storedAmount(amount: number | string): string {
	return roundRateDec(amount, AMOUNT_DECIMALS).toFixed();
}

/** num / den, kept apart so a chain of rates divides once and an exact tie stays a tie. */
type Fraction = readonly [Decimal, Decimal];

const ONE: Fraction = [new Dec(1), new Dec(1)];

interface Leg {
	/** USD per unit of the leg's currency, as an exact fraction. */
	usd: Fraction;
	/** The table type used; empty for USD, whose rate is always 1. */
	type: string;
}

async function legOf(
	ctx: BookContext,
	currency: string,
	date: Date,
	rateType: string | null,
): Promise<Leg> {
	if (currency === USD) return { usd: ONE, type: "" };
	const picked = await ctx.find(currency, date, rateType);
	if (!picked) throw new MissingRateError(currency);
	return { usd: usdFractionDec(currency, picked.rate), type: picked.type };
}

/** An entry's rate as exact fractions: USD per entry unit, and home units per entry unit. */
interface Exact {
	usd: Fraction;
	home: Fraction;
}

/**
 * The stored-convention rate for a USD value per unit: fiat units per USD,
 * crypto USD per unit. A leg that prices no rate above zero (a USD value of
 * 0, an amount of 0) is a missing rate, never 1.
 */
function storedRate(currency: string, [num, den]: Fraction): Decimal {
	if (currency === USD) return new Dec(1);
	const rate = isCrypto(currency) ? num.div(den) : den.div(num);
	if (!rate.isFinite() || !rate.gt(0)) throw new MissingRateError(currency);
	return rate;
}

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
 * The stored row for an entry's exact rate. Each figure is one division of
 * exact products, rounded once, half to even: amountInUSD from the exact
 * entry leg (D4, the same rate as the home amount, not the 6-decimal
 * exchangeRate), the home amount from the exact cross rate, not its
 * 12-decimal copy (a tiny rate, ARS into a BTC home, keeps too few digits at
 * 12 decimals for amounts in the millions).
 */
function booked(
	entry: EntryAmount,
	ctx: BookContext,
	{ usd, home }: Exact,
	rateType: string | null,
): BookedRate {
	const amount = dec(entry.amount);
	return {
		exchangeRate: roundRateDec(
			storedRate(entry.currency, usd),
			EXCHANGE_RATE_DECIMALS,
		).toFixed(),
		amountInUSD: roundUSDDec(amount.mul(usd[0]).div(usd[1])).toFixed(2),
		rateType,
		homeCurrency: ctx.homeCurrency,
		homeRate: roundRateDec(home[0].div(home[1]), HOME_RATE_DECIMALS).toFixed(),
		homeAmount: roundMoneyDec(
			amount.mul(home[0]).div(home[1]),
			ctx.homeCurrency,
		).toFixed(currencyDecimals(ctx.homeCurrency)),
	};
}

/**
 * Both fractions for an entry leg from a rate (table or kept): the home leg
 * from the table, the same currency is 1, a USD home needs no table rate.
 */
async function exactFor(
	ctx: BookContext,
	entry: EntryAmount,
	entryLeg: Leg,
	rateType: string | null,
): Promise<{ exact: Exact; legs: Leg[] }> {
	const usd = entryLeg.usd;
	const home = ctx.homeCurrency;
	if (home === entry.currency) {
		return { exact: { usd, home: ONE }, legs: [entryLeg] };
	}
	const homeLeg = await legOf(ctx, home, entry.date, rateType ?? ctx.preferred);
	const [homeNum, homeDen] = homeLeg.usd;
	// (USD per entry unit) / (USD per home unit), as one fraction (D3).
	const cross: Fraction = [usd[0].mul(homeDen), usd[1].mul(homeNum)];
	return { exact: { usd, home: cross }, legs: [homeLeg, entryLeg] };
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
	// Home units per entry unit: the typed rate, or its inverse when quoted in home.
	const perUnit: Fraction =
		choice.base === entry.currency ? [typed, new Dec(1)] : [new Dec(1), typed];
	const homeLeg = await legOf(ctx, home, entry.date, ctx.preferred);
	const [homeNum, homeDen] = homeLeg.usd;
	// The entry leg comes from the typed rate itself, not its rounded copy; USD is always 1.
	const usd: Fraction =
		entry.currency === USD
			? ONE
			: [perUnit[0].mul(homeNum), perUnit[1].mul(homeDen)];
	return booked(entry, ctx, { usd, home: perUnit }, CUSTOM_RATE_TYPE);
}

async function bookChoice(
	ctx: BookContext,
	entry: EntryAmount,
	choice: RateChoice,
): Promise<BookedRate> {
	switch (choice.kind) {
		case "custom":
			return bookCustom(ctx, entry, choice);
		case "kept": {
			// The saved 12-decimal home rate: there is no table pair to divide (D3).
			const exact = {
				usd: usdFractionDec(entry.currency, choice.exchangeRate),
				home: [new Dec(choice.homeRate), new Dec(1)] as const,
			};
			return booked(entry, ctx, exact, choice.rateType);
		}
		case "entryLeg": {
			const custom = choice.rateType === CUSTOM_RATE_TYPE;
			const entryLeg = {
				usd: usdFractionDec(entry.currency, choice.exchangeRate),
				type: custom || entry.currency === USD ? "" : (choice.rateType ?? ""),
			};
			// A kept or typed entry leg says nothing about the home leg's type: the default applies.
			const { exact, legs } = await exactFor(ctx, entry, entryLeg, null);
			const rateType = custom ? CUSTOM_RATE_TYPE : labelFor(null, legs);
			return booked(entry, ctx, exact, rateType);
		}
		case "usdValue": {
			// booked() refuses a leg that prices no rate (storedRate).
			const entryLeg: Leg = {
				usd:
					entry.currency === USD
						? ONE
						: [dec(choice.usd), dec(entry.amount)],
				type: "",
			};
			const { exact, legs } = await exactFor(ctx, entry, entryLeg, null);
			return booked(entry, ctx, exact, labelFor(null, legs));
		}
		case "table": {
			const type = choice.rateType ?? ctx.preferred;
			const entryType = choice.rateType ?? choice.entryType ?? ctx.preferred;
			const entryLeg = await legOf(ctx, entry.currency, entry.date, entryType);
			const { exact, legs } = await exactFor(ctx, entry, entryLeg, type);
			return booked(entry, ctx, exact, labelFor(type, legs));
		}
	}
}

const sameDecimal = (a: DecimalInput, b: DecimalInput) => dec(a).eq(dec(b));

/**
 * The edit moves no money (D1): same amount, currency and date, and it books
 * the rate it was saved with (both legs, into the same home). Rate choice is
 * rateChoice's; this only decides whether the saved figures stand.
 */
function moneyUntouched(
	entry: EntryAmount,
	saved: SavedRate,
	rate: BookedRate,
): saved is SavedRate & { homeAmount: string } {
	return (
		saved.homeAmount !== null &&
		saved.homeRate !== null &&
		saved.currency === entry.currency &&
		saved.date.getTime() === entry.date.getTime() &&
		sameDecimal(saved.amount, entry.amount) &&
		saved.homeCurrency === rate.homeCurrency &&
		sameDecimal(saved.exchangeRate, rate.exchangeRate) &&
		sameDecimal(saved.homeRate, rate.homeRate)
	);
}

/**
 * Books an entry's rate under `choice` (see RateChoice). An edit passes the
 * row as saved: when the edit moves no money, the saved amountInUSD and
 * homeAmount come back unchanged, so an edit never re-rounds a stored figure
 * (a row booked half up before half even keeps its cent).
 */
export async function bookRate(
	ctx: BookContext,
	entry: EntryAmount,
	choice: RateChoice,
	saved?: SavedRate | null,
): Promise<BookedRate> {
	const rate = await bookChoice(ctx, entry, choice);
	if (!saved || !moneyUntouched(entry, saved, rate)) return rate;
	return {
		...rate,
		amountInUSD: saved.amountInUSD,
		homeAmount: saved.homeAmount,
	};
}
