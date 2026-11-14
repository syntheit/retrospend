/**
 * The rates of the parity ledger (E2EE P16): a deterministic daily series per
 * currency and type, the rows that put it in the exchange_rate table, and the
 * stored money fields a row gets from it (`book`).
 *
 * The exchange_rate table is shared by every file of a worker's database, so
 * the seed adds only the rows that are not there and `dropParityRates`
 * deletes exactly the ones it added, by id. The history table is never read by
 * a price; `seedWildHistory` puts rows with rates no day ever had in it, to
 * show that.
 */
import {
	columnText,
	computeAmountInUSDDec,
	convertDec,
	crossRateDec,
	roundMoneyDec,
} from "@retrospend/domain/money-dec";
import type { Prisma } from "~prisma";
import { adminDb } from "../pg-harness";
import { DAY } from "./seed-context";

const RATES_START = Date.UTC(2025, 0, 1);
const RATE_DAYS = 790;

/** Units per USD, by "CURRENCY:type", as exact decimal text, a function of the day index. */
const RATE_SERIES: Record<string, (day: number) => string> = {
	"ARS:blue": (i) => String(1000 + Math.floor(i * 0.8)),
	"ARS:official": (i) => String(900 + Math.floor(i * 0.3)),
	"ARS:mep": (i) => String(1050 + Math.floor(i * 0.75)),
	"JPY:official": (i) => String(140 + (i % 30)),
	"KWD:official": (i) => (0.3 + (i % 5) / 1000).toFixed(3),
};

const dayIndex = (at: Date) =>
	Math.min(
		RATE_DAYS,
		Math.max(0, Math.floor((at.getTime() - RATES_START) / DAY)),
	);

/** The rate the seed table holds for `currency` on `at`, or null when it has none of that type. USD is 1. */
export function seedRate(
	currency: string,
	type: string,
	at: Date,
): string | null {
	if (currency === "USD") return "1";
	return RATE_SERIES[`${currency}:${type}`]?.(dayIndex(at)) ?? null;
}

export interface RateSeed {
	/** The exchange_rate ids this seed added; the rest were already there. */
	ids: string[];
}

/** One row per currency and type every `stepDays`, over 2025-01-01 to 2027-02-28, skipping rows that exist. */
export async function seedParityRates(stepDays: number): Promise<RateSeed> {
	const data: Prisma.ExchangeRateCreateManyInput[] = [];
	for (let i = 0; i <= RATE_DAYS; i += stepDays)
		for (const [key, series] of Object.entries(RATE_SERIES)) {
			const [currency, type] = key.split(":") as [string, string];
			data.push({
				date: new Date(RATES_START + i * DAY),
				currency,
				type,
				rate: series(i),
			});
		}
	const added = await adminDb.exchangeRate.createManyAndReturn({
		data,
		skipDuplicates: true,
		select: { id: true },
	});
	return { ids: added.map((r) => r.id) };
}

export async function dropParityRates(seed: RateSeed): Promise<void> {
	await adminDb.exchangeRate.deleteMany({ where: { id: { in: seed.ids } } });
}

/** Rows of the history table no price reads, with rates no day ever had; `dropWildHistory` removes them. */
export async function seedWildHistory() {
	const keys = [
		["2026-10-14", "ARS", "blue", "1"],
		["2026-10-15", "ARS", "official", "99999"],
		["2026-10-15", "JPY", "official", "0.001"],
		["2026-10-15", "KWD", "official", "777"],
	].map(([date, currency, type, rate]) => ({
		date: new Date(`${date}T00:00:00Z`),
		currency: currency as string,
		type: type as string,
		rate: rate as string,
	}));
	// The table has no id (its key is date, currency and type): only the rows
	// this call actually created are returned, and only those are dropped.
	return adminDb.exchangeRateHistory.createManyAndReturn({
		data: keys,
		skipDuplicates: true,
	});
}

export async function dropWildHistory(
	added: Awaited<ReturnType<typeof seedWildHistory>>,
) {
	for (const k of added)
		await adminDb.exchangeRateHistory.delete({
			where: {
				date_currency_type: {
					date: k.date,
					currency: k.currency,
					type: k.type,
				},
			},
		});
}

export interface Booking {
	exchangeRate: string;
	amountInUSD: string;
	rateType: string | null;
	homeCurrency: string | null;
	homeRate: string | null;
	homeAmount: string | null;
}

/**
 * The stored money fields of a row of `amount` in `currency` on `at`: its USD
 * value at the table's rate for the day, and, when `type` is set, the home leg
 * booked at that rate type (null when the table has no such rate, as an
 * unpriced row is saved).
 */
export function book(
	amount: string,
	currency: string,
	at: Date,
	home: string,
	type: string | null,
): Booking {
	const rateCur =
		seedRate(currency, type ?? "official", at) ??
		seedRate(currency, "official", at) ??
		"1";
	const base = {
		exchangeRate: columnText(rateCur, 6),
		amountInUSD: computeAmountInUSDDec(amount, currency, rateCur).toFixed(2),
	};
	const none = {
		rateType: null,
		homeCurrency: null,
		homeRate: null,
		homeAmount: null,
	};
	if (type === null) return { ...base, ...none };
	if (currency === home)
		return {
			...base,
			rateType: type,
			homeCurrency: home,
			homeRate: "1",
			homeAmount: amount,
		};
	const rateHome = seedRate(home, type, at);
	if (rateHome === null) return { ...base, ...none };
	return {
		...base,
		rateType: type,
		homeCurrency: home,
		homeRate: columnText(crossRateDec(currency, rateCur, home, rateHome), 12),
		homeAmount: roundMoneyDec(
			convertDec(amount, currency, rateCur, home, rateHome),
			home,
		).toFixed(),
	};
}
