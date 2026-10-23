/**
 * The rate an imported row is saved at (M2, GAPS "Writers that skip the
 * booked home value"): the review shows it and the commit stores it, so the
 * home value on screen is the one saved. A rate in the file (or a USD amount)
 * is the entry leg; otherwise both legs come from the table at the user's
 * default rate type, like the Add sheet. The home leg is booked with
 * `bookRate`; when the table has no home rate the row keeps its entry leg
 * and no home leg (the totals rule applies), never a rate of 1.
 */
import {
	computeAmountInUSD,
	isValidRate,
	MissingRateError,
	rateFromUsdPerUnit,
	USD,
} from "~/lib/money";
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
	exchangeRate: number;
	amountInUSD: number;
	home: HomeLeg | null;
}

/** The entry leg the file brings: its rate, or one derived from its USD amount. */
export function fileRateOf(row: ImportRateInput): number | null {
	const currency = row.currency.toUpperCase();
	// A rate the reader looked up (at no rate type) is not the file's: the
	// table books it again at the user's default type.
	if (currency === USD || row.rateSource === "table") return null;
	if (isValidRate(row.exchangeRate)) return row.exchangeRate;
	if (isValidRate(row.amountInUSD) && row.amount > 0)
		return rateFromUsdPerUnit(currency, row.amountInUSD / row.amount);
	return null;
}

function split(booked: BookedRate): ImportRate {
	return {
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
	const entry = { amount: row.amount, currency, date: row.date };
	const fileRate = fileRateOf(row);
	try {
		const booked =
			fileRate != null
				? await bookRate(db, ctx, entry, {
						kind: "entryLeg",
						exchangeRate: fileRate,
						rateType: null,
					})
				: await bookRate(db, ctx, entry, { kind: "table", rateType: null });
		return split(booked);
	} catch (error) {
		if (!(error instanceof MissingRateError)) throw error;
	}
	// No home rate in the table: keep the entry leg alone, if there is one.
	const rate =
		fileRate ??
		(currency === USD
			? 1
			: (await findExchangeRate(db, currency, row.date))?.rate);
	if (rate == null) return null;
	return {
		exchangeRate: rate,
		amountInUSD: computeAmountInUSD(row.amount, currency, rate),
		home: null,
	};
}
