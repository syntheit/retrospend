/**
 * Rate types per user and per entry (M2, N73, ADD-EXPENSE-R2 T7).
 *
 * - The default rate type is a preference per home currency, saved in
 *   `user.defaultRateTypes` ({"ARS": "blue"}); without one the built-in
 *   default applies (ARS: blue, elsewhere the table's own order).
 * - A pair (entry currency, home currency) offers every type either side has
 *   in the rate table; one type applies to both legs through USD, each leg
 *   falling back to its best rate when its currency lacks the type.
 * - `bookRate` books an entry's home leg once: the cross rate (units of home
 *   per 1 unit of the entry currency, 12 decimals, half-even) and the home
 *   amount it gives (home minor units, half-even), in Decimal math. A rate
 *   that is not there throws MissingRateError; it is never 0 or 1.
 *
 * The entry leg keeps today's stored convention and float math
 * (exchangeRate per USD, amountInUSD rounded to cents, ~/lib/money).
 */

import { Decimal } from "@prisma/client/runtime/index-browser";
import { type Money, money, toMinor } from "@retrospend/domain/money-minor";
import { TRPCError } from "@trpc/server";
import { isCrypto } from "~/lib/currency-format";
import {
	computeAmountInUSD,
	currencyDecimals,
	MissingRateError,
	rateFromUsdPerUnit,
	USD,
} from "~/lib/money";
import {
	CUSTOM_RATE_TYPE,
	isRateTypeKey,
	pairRateTypes,
	pickDefaultRateType,
	preferredRateType,
} from "~/lib/rate-selection";
import { findExchangeRate } from "~/server/exchange-rates";
import type { Prisma, PrismaClient } from "~prisma";

type RateDb = Pick<
	PrismaClient | Prisma.TransactionClient,
	"exchangeRate" | "user"
>;

/** Enough digits for amount x rate at any scale we store, rounding half-even. */
const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

/** Scale of expense.homeRate (DECIMAL(28,12)). */
const HOME_RATE_DECIMALS = 12;
const CURRENCY_KEY = /^[A-Z0-9]{3,10}$/;

export interface RateContext {
	userId: string;
	homeCurrency: string;
	/** The user's preferred type for conversions into their home, or null. */
	preferred: string | null;
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
	/** A typed rate between the two currencies: 1 `base` = `value` of the other. */
	| { kind: "custom"; base: string; value: number };

export interface EntryAmount {
	/** A decimal string keeps a typed amount exact (a transfer fee). */
	amount: number | string;
	currency: string;
	date: Date;
}

// ── The user's default ───────────────────────────────────────────────────────

/** The saved defaults, keeping only well-formed pairs (the column is free JSON). */
function parseDefaults(raw: unknown): Record<string, string> {
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

async function loadUser(db: RateDb, userId: string) {
	const user = await db.user.findUnique({
		where: { id: userId },
		select: { homeCurrency: true, defaultRateTypes: true },
	});
	if (!user) {
		throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
	}
	return {
		homeCurrency: user.homeCurrency,
		defaults: parseDefaults(user.defaultRateTypes),
	};
}

export async function getDefaultRateTypes(
	db: RateDb,
	userId: string,
): Promise<Record<string, string>> {
	return (await loadUser(db, userId)).defaults;
}

/**
 * Saves the user's default rate type for `homeCurrency`; null goes back to
 * the built-in default. Custom is a typed rate, never a default.
 */
export async function setDefaultRateType(
	db: RateDb,
	userId: string,
	homeCurrency: string,
	rateType: string | null,
): Promise<Record<string, string>> {
	if (!CURRENCY_KEY.test(homeCurrency)) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown currency" });
	}
	if (
		rateType !== null &&
		(!isRateTypeKey(rateType) || rateType === CUSTOM_RATE_TYPE)
	) {
		throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown rate type" });
	}
	const { [homeCurrency]: _replaced, ...others } = await getDefaultRateTypes(
		db,
		userId,
	);
	const next =
		rateType === null ? others : { ...others, [homeCurrency]: rateType };
	await db.user.update({
		where: { id: userId },
		data: { defaultRateTypes: next },
	});
	return next;
}

export async function loadRateContext(
	db: RateDb,
	userId: string,
): Promise<RateContext> {
	const { homeCurrency, defaults } = await loadUser(db, userId);
	return {
		userId,
		homeCurrency,
		preferred: preferredRateType(homeCurrency, defaults),
	};
}

// ── Legs ─────────────────────────────────────────────────────────────────────

interface Leg {
	rate: number;
	/** The table type used; empty for USD, whose rate is always 1. */
	type: string;
}

async function legOf(
	db: RateDb,
	currency: string,
	date: Date,
	rateType: string | null,
): Promise<Leg> {
	if (currency === USD) return { rate: 1, type: "" };
	const picked = await findExchangeRate(db, currency, date, rateType);
	if (!picked) throw new MissingRateError(currency);
	return { rate: picked.rate, type: picked.type };
}

/** USD value of one unit of `currency` at its stored-convention rate. */
function usdPerUnit(currency: string, rate: number): Decimal {
	if (currency === USD) return new Dec(1);
	return isCrypto(currency) ? new Dec(rate) : new Dec(1).div(new Dec(rate));
}

const roundRate = (value: Decimal) =>
	value.toDecimalPlaces(HOME_RATE_DECIMALS, Decimal.ROUND_HALF_EVEN);

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
	ctx: RateContext,
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
		homeAmount: new Dec(entry.amount)
			.mul(exactRate)
			.toDecimalPlaces(decimals, Decimal.ROUND_HALF_EVEN)
			.toFixed(decimals),
	};
}

/** Home leg for an entry leg: the same currency is 1, a USD home needs no table rate. */
async function homeRateFor(
	db: RateDb,
	ctx: RateContext,
	entry: EntryAmount,
	entryLeg: Leg,
	rateType: string | null,
): Promise<{ homeRate: Decimal; legs: Leg[] }> {
	const home = ctx.homeCurrency;
	if (home === entry.currency) {
		return { homeRate: new Dec(1), legs: [entryLeg] };
	}
	const homeLeg = await legOf(db, home, entry.date, rateType ?? ctx.preferred);
	const homeRate = usdPerUnit(entry.currency, entryLeg.rate).div(
		usdPerUnit(home, homeLeg.rate),
	);
	return { homeRate, legs: [homeLeg, entryLeg] };
}

/** A typed cross rate; the entry leg is derived from it through the home leg's table rate. */
async function bookCustom(
	db: RateDb,
	ctx: RateContext,
	entry: EntryAmount,
	choice: { base: string; value: number },
): Promise<BookedRate> {
	const home = ctx.homeCurrency;
	if (
		entry.currency === home ||
		![entry.currency, home].includes(choice.base)
	) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `A custom rate converts ${entry.currency} to ${home}`,
		});
	}
	if (!(choice.value > 0) || !Number.isFinite(choice.value)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Enter a rate above 0",
		});
	}
	const typed = new Dec(choice.value);
	const perUnit =
		choice.base === entry.currency ? typed : new Dec(1).div(typed);
	const homeLeg = await legOf(db, home, entry.date, ctx.preferred);
	// The entry leg comes from the typed rate itself, not its rounded copy.
	const usd = perUnit.mul(usdPerUnit(home, homeLeg.rate));
	const exchangeRate = rateFromUsdPerUnit(entry.currency, usd.toNumber());
	return booked(entry, ctx, exchangeRate, perUnit, CUSTOM_RATE_TYPE);
}

/** Books an entry's rate under `choice` (see RateChoice). */
export async function bookRate(
	db: RateDb,
	ctx: RateContext,
	entry: EntryAmount,
	choice: RateChoice,
): Promise<BookedRate> {
	switch (choice.kind) {
		case "custom":
			return bookCustom(db, ctx, entry, choice);
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
			const { homeRate, legs } = await homeRateFor(
				db,
				ctx,
				entry,
				entryLeg,
				null,
			);
			const rateType = custom ? CUSTOM_RATE_TYPE : labelFor(null, legs);
			return booked(entry, ctx, choice.exchangeRate, homeRate, rateType);
		}
		case "table": {
			const type = choice.rateType ?? ctx.preferred;
			const entryType = choice.rateType ?? choice.entryType ?? ctx.preferred;
			const entryLeg = await legOf(db, entry.currency, entry.date, entryType);
			const { homeRate, legs } = await homeRateFor(
				db,
				ctx,
				entry,
				entryLeg,
				type,
			);
			return booked(entry, ctx, entryLeg.rate, homeRate, labelFor(type, legs));
		}
	}
}

/**
 * A row's booked home value as Money, when it was booked in `homeCurrency`
 * (the currency a list shows): the client shows it as is instead of
 * converting the USD value at today's rate. Null for rows with no booked
 * value or one in another currency.
 */
export function bookedHome(
	row: {
		homeCurrency: string | null;
		homeAmount: Prisma.Decimal | null;
	},
	homeCurrency: string,
): Money | null {
	if (row.homeCurrency !== homeCurrency || row.homeAmount === null) {
		return null;
	}
	return money(toMinor(row.homeAmount, homeCurrency), homeCurrency);
}

// ── What the Add sheet offers ───────────────────────────────────────────────

async function typesOf(db: RateDb, currency: string): Promise<string[]> {
	if (currency === USD) return [];
	const rows = await db.exchangeRate.findMany({
		where: { currency },
		distinct: ["type"],
		select: { type: true },
	});
	return [...new Set(rows.map((r) => r.type))];
}

export interface RateOption {
	rateType: string;
	/** Units of home per 1 unit of the entry currency. */
	homeRate: string;
	/** The home amount for the asked amount, or null when none was asked. */
	homeAmount: string | null;
}

export interface RateOptions {
	homeCurrency: string;
	/** The option the picker starts on; null when there is nothing to pick. */
	defaultType: string | null;
	/** One per table type the pair offers, in picker order. Custom is always offered too. */
	options: RateOption[];
	/** Set when the pair has no rate at all: the sheet shows "No rate yet" and blocks saving. */
	missing: { currency: string } | null;
}

/**
 * The rate strip of the Add sheet for an entry in `currency` on `date`: each
 * type the pair offers, booked exactly as saving it would book it. A
 * same-currency entry offers none (there is nothing to convert into home).
 */
export async function rateOptions(
	db: RateDb,
	userId: string,
	input: { currency: string; date: Date; amount?: number },
): Promise<RateOptions> {
	const ctx = await loadRateContext(db, userId);
	const none: RateOptions = {
		homeCurrency: ctx.homeCurrency,
		defaultType: null,
		options: [],
		missing: null,
	};
	if (input.currency === ctx.homeCurrency) return none;
	const entry = {
		amount: input.amount ?? 0,
		currency: input.currency,
		date: input.date,
	};
	const offered = pairRateTypes(
		await typesOf(db, input.currency),
		await typesOf(db, ctx.homeCurrency),
	);
	const options: RateOption[] = [];
	try {
		// With no types at all this names the currency that has no rate.
		if (offered.length === 0) {
			await bookRate(db, ctx, entry, { kind: "table", rateType: null });
		}
		for (const rateType of offered) {
			const rate = await bookRate(db, ctx, entry, { kind: "table", rateType });
			// A type neither leg can use near this date is not an option.
			if (rate.rateType !== rateType) continue;
			options.push({
				rateType,
				homeRate: rate.homeRate,
				homeAmount: input.amount === undefined ? null : rate.homeAmount,
			});
		}
	} catch (error) {
		if (!(error instanceof MissingRateError)) throw error;
		return { ...none, missing: { currency: error.currency } };
	}
	return {
		...none,
		defaultType: pickDefaultRateType(
			options.map((o) => o.rateType),
			ctx.preferred,
		),
		options,
	};
}

/**
 * The reference rate type for converting `currency` for this user (payments
 * and balances read it, MONEY-MOVES §0): the option the Add sheet starts on
 * today. Null when there is nothing to convert or no rate at all.
 */
export async function defaultRateType(
	db: RateDb,
	userId: string,
	currency: string,
): Promise<string | null> {
	return (await rateOptions(db, userId, { currency, date: new Date() }))
		.defaultType;
}
