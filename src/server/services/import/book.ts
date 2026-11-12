/**
 * The rate an imported row is saved at (M2, GAPS "Writers that skip the
 * booked home value"): the review shows it and the commit stores it, so the
 * home value on screen is the one saved. A rate in the file (or a USD amount)
 * is the entry leg; otherwise both legs come from the table at the user's
 * default rate type, like the Add sheet. The home leg is booked with
 * `bookRate`; when the table has no home rate the row keeps its entry leg
 * and no home leg (the totals rule applies), never a rate of 1. A USD amount
 * books as the exact fraction USD / amount, so the stored amountInUSD is
 * the file's USD to cents. The amount is stored and booked at the column's
 * 8 decimals, half to even.
 */
import { isValidRate, MissingRateError, USD } from "@retrospend/domain/money";
import {
	computeAmountInUSDDec,
	rateFromUsdAmountDec,
	roundRateDec,
	roundUSDDec,
} from "@retrospend/domain/money-dec";
import { type RateChoice, storedAmount } from "@retrospend/domain/rate-booking";
import { findExchangeRate } from "~/server/exchange-rates";
import type { Prisma, PrismaClient } from "~prisma";
import { type BookedRate, bookRate, type RateContext } from "../rate-types";

type RateDb = Pick<
	PrismaClient | Prisma.TransactionClient,
	"exchangeRate" | "user"
>;

export interface ImportRateInput {
	amount: number;
	currency: string;
	date: Date;
	exchangeRate?: number;
	amountInUSD?: number;
	/** "table": the reader filled the rate in itself, so it is not the file's. */
	rateSource?: "table";
}

export interface HomeLeg {
	rateType: string | null;
	homeCurrency: string;
	/** Units of home per 1 unit of the row's currency (decimal string). */
	homeRate: string;
	/** The booked home amount (decimal string at home minor units). */
	homeAmount: string;
}

export interface ImportRate {
	/** Decimal text at the columns' scale, half to even. */
	amount: string;
	exchangeRate: string;
	amountInUSD: string;
	home: HomeLeg | null;
}

type FileLeg = Extract<RateChoice, { kind: "entryLeg" | "usdValue" }>;

/**
 * The entry leg alone, as bookRate stores it: the leg at 6 decimals and the
 * USD value from the exact leg, half to even, as decimal text. From a USD
 * amount the exact rate is USD / amount, so the USD value is that amount.
 * A leg that prices no rate (an amount of 0 at 8 decimals) throws
 * MissingRateError. The CSV import and a row with no home leg both use it.
 */
export function entryLegOnly(
	currency: string,
	amount: string,
	leg: FileLeg,
): { exchangeRate: string; amountInUSD: string } {
	if (leg.kind === "entryLeg") {
		return {
			exchangeRate: roundRateDec(leg.exchangeRate, 6).toFixed(),
			amountInUSD: computeAmountInUSDDec(
				amount,
				currency,
				leg.exchangeRate,
			).toFixed(2),
		};
	}
	const rate = rateFromUsdAmountDec(currency, leg.usd, amount);
	return {
		exchangeRate: roundRateDec(rate, 6).toFixed(),
		amountInUSD: roundUSDDec(leg.usd).toFixed(2),
	};
}

/** A rate as an entry leg with no type of its own. */
export const legAt = (exchangeRate: number): FileLeg => ({
	kind: "entryLeg",
	exchangeRate,
	rateType: null,
});

/** The entry leg the file brings: its rate, or its USD amount. */
export function fileLegOf(row: ImportRateInput): FileLeg | null {
	const currency = row.currency.toUpperCase();
	// A rate the reader looked up (at no rate type) is not the file's: the
	// table books it again at the user's default type.
	if (currency === USD || row.rateSource === "table") return null;
	if (isValidRate(row.exchangeRate)) return legAt(row.exchangeRate);
	if (isValidRate(row.amountInUSD) && row.amount > 0)
		return { kind: "usdValue", usd: row.amountInUSD };
	return null;
}

function split(amount: string, booked: BookedRate): ImportRate {
	return {
		amount,
		exchangeRate: booked.exchangeRate,
		amountInUSD: booked.amountInUSD,
		home: {
			rateType: booked.rateType,
			homeCurrency: booked.homeCurrency,
			homeRate: booked.homeRate,
			homeAmount: booked.homeAmount,
		},
	};
}

/**
 * Both legs of an imported row, or null when not even the entry leg has a
 * rate (the row cannot be saved and is skipped as "no rate").
 */
export async function bookImportRow(
	db: RateDb,
	ctx: RateContext,
	row: ImportRateInput,
): Promise<ImportRate | null> {
	const currency = row.currency.toUpperCase();
	const amount = storedAmount(row.amount);
	const entry = { amount, currency, date: row.date };
	const fileLeg = fileLegOf(row);
	try {
		const choice: RateChoice = fileLeg ?? { kind: "table", rateType: null };
		return split(amount, await bookRate(db, ctx, entry, choice));
	} catch (error) {
		if (!(error instanceof MissingRateError)) throw error;
	}
	// No home rate in the table: keep the entry leg alone, if there is one.
	const rate =
		currency === USD
			? 1
			: fileLeg
				? null
				: (await findExchangeRate(db, currency, row.date))?.rate;
	const leg = fileLeg ?? (rate == null ? null : legAt(rate));
	if (!leg) return null;
	try {
		return { amount, ...entryLegOnly(currency, amount, leg), home: null };
	} catch (error) {
		// An amount of 0 at 8 decimals prices no rate: only this row is skipped.
		if (error instanceof MissingRateError) return null;
		throw error;
	}
}
