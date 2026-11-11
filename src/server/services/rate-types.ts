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
 * (exchangeRate per USD, amountInUSD rounded to cents, @retrospend/domain/money).
 */

import { MissingRateError, USD } from "@retrospend/domain/money";
import { type Money, money, toMinor } from "@retrospend/domain/money-minor";
import {
	type BookContext,
	type BookedRate,
	bookRate as bookRateWith,
	type EntryAmount,
	isRateTypeKey,
	parseRateDefaults,
	preferredRateType,
	type RateChoice,
	RateInputError,
} from "@retrospend/domain/rate-booking";
import { TRPCError } from "@trpc/server";
import {
	CUSTOM_RATE_TYPE,
	pairRateTypes,
	pickDefaultRateType,
} from "~/lib/rate-selection";
import { findExchangeRate } from "~/server/exchange-rates";
import type { Prisma, PrismaClient } from "~prisma";

type RateDb = Pick<
	PrismaClient | Prisma.TransactionClient,
	"exchangeRate" | "user"
>;

const CURRENCY_KEY = /^[A-Z0-9]{3,10}$/;

export type { BookedRate, EntryAmount, RateChoice };

export interface RateContext {
	userId: string;
	homeCurrency: string;
	/** The user's preferred type for conversions into their home, or null. */
	preferred: string | null;
}

/** Bad rate input is a BAD_REQUEST to the form; everything else passes through. */
export function asBadRequest<T>(run: () => T): T {
	try {
		return run();
	} catch (error) {
		if (error instanceof RateInputError)
			throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
		throw error;
	}
}

// ── The user's default ───────────────────────────────────────────────────────

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
		defaults: parseRateDefaults(user.defaultRateTypes),
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
		select: { id: true },
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

/** Books an entry's rate under `choice` (see RateChoice), reading the rate table through `db`. */
export async function bookRate(
	db: RateDb,
	ctx: RateContext,
	entry: EntryAmount,
	choice: RateChoice,
): Promise<BookedRate> {
	const book: BookContext = {
		homeCurrency: ctx.homeCurrency,
		preferred: ctx.preferred,
		find: (currency, date, type) => findExchangeRate(db, currency, date, type),
	};
	try {
		return await bookRateWith(book, entry, choice);
	} catch (error) {
		return asBadRequest(() => {
			throw error;
		});
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
	/** A typed rate (1 entry unit = `customRate` home), booked as Save books it; null when none was typed. */
	custom: RateOption | null;
}

/**
 * The rate strip of the Add sheet for an entry in `currency` on `date`: each
 * type the pair offers, booked exactly as saving it would book it. A
 * same-currency entry offers none (there is nothing to convert into home).
 */
export async function rateOptions(
	db: RateDb,
	userId: string,
	input: { currency: string; date: Date; amount?: string; customRate?: string },
): Promise<RateOptions> {
	const ctx = await loadRateContext(db, userId);
	const empty: RateOptions = {
		homeCurrency: ctx.homeCurrency,
		defaultType: null,
		options: [],
		missing: null,
		custom: null,
	};
	if (input.currency === ctx.homeCurrency) return empty;
	const entry = {
		amount: input.amount ?? 0,
		currency: input.currency,
		date: input.date,
	};
	// A typed rate needs no table rate: it is offered even when the pair has none.
	const custom =
		input.customRate === undefined
			? null
			: await bookRate(db, ctx, entry, {
					kind: "custom",
					base: input.currency,
					value: input.customRate,
				}).catch((error) => {
					// No home leg either: Save will say so; the strip shows no figure.
					if (error instanceof MissingRateError) return null;
					throw error;
				});
	const none: RateOptions = {
		...empty,
		custom: custom && {
			rateType: CUSTOM_RATE_TYPE,
			homeRate: custom.homeRate,
			homeAmount: input.amount === undefined ? null : custom.homeAmount,
		},
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
