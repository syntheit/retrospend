/**
 * Detection and fixes for expenses whose stored exchangeRate / amountInUSD
 * break the stored rate convention (see @retrospend/domain/money). Pure: the DB access
 * lives in scripts/repair-amount-in-usd.ts.
 *
 * Reasons (one per expense, first match wins):
 *   usd-rate      USD expense with a rate other than 1
 *   usd-amount    USD expense whose amountInUSD is not its amount
 *   rate-one      non-USD expense stored at rate 1 (old "home currency" bug)
 *   cross-rate    rate is the old form's home-per-foreign cross rate for the
 *                 owner's home currency instead of the currency's own rate
 *   implausible   rate more than 10x away from the rate table (e.g. crypto
 *                 stored the wrong way round)
 *   usd-mismatch  rate looks right but amountInUSD was not computed from it
 *                 (crypto imported in the wrong direction, ARS "crypto" type
 *                 booked by the old sidecar)
 *
 * Fixes: usd-mismatch keeps the rate and recomputes amountInUSD. The rate
 * reasons replace the rate with a reference rate (median of healthy expenses
 * in the same currency within 30 days, else the rate table's nearest rate).
 * An implausible rate whose amountInUSD is itself plausible keeps that
 * amount and gets a rate derived from it. The rate table only keeps the
 * latest rate, so old expenses are compared with today's rate: thresholds are
 * wide on purpose, and the script prints the worst cases for review.
 */
import { isCrypto } from "@retrospend/domain/currency-format";
import {
	computeAmountInUSD,
	isValidRate,
	pickBestRate,
	type RateRow,
	rateFromUsdPerUnit,
	roundUSD,
	toUSD,
	USD,
} from "@retrospend/domain/money";

export type RepairReason =
	| "usd-rate"
	| "usd-amount"
	| "rate-one"
	| "cross-rate"
	| "implausible"
	| "usd-mismatch";

export interface RepairExpense {
	id: string;
	userId: string;
	date: Date;
	currency: string;
	amount: number;
	exchangeRate: number;
	amountInUSD: number;
	pricingSource: string | null;
	isAmortizedChild?: boolean;
}

export interface RepairFinding {
	row: RepairExpense;
	home: string;
	reason: RepairReason;
	newRate: number;
	newUSD: number;
}

const IMPLAUSIBLE_FACTOR = 10;
const CROSS_MIN_GAP = Math.log(1.25);
const REFERENCE_WINDOW_MS = 30 * 86_400_000;

const logDistance = (a: number, b: number) => Math.abs(Math.log(a / b));

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[mid]!
		: (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function usdMatches(row: RepairExpense, rate: number): boolean {
	const expected = computeAmountInUSD(row.amount, row.currency, rate);
	return (
		Math.abs(expected - row.amountInUSD) <= Math.max(0.02, expected * 0.005)
	);
}

/** The rate the old expense form stored for `currency` with `home` home. */
function oldFormCrossRate(
	currency: string,
	tableRate: number,
	homeRate: number,
): number {
	return isCrypto(currency) ? tableRate * homeRate : homeRate / tableRate;
}

export function findInconsistentExpenses(args: {
	expenses: RepairExpense[];
	homeCurrencyOf: (userId: string) => string;
	rates: Array<RateRow & { currency: string }>;
}): { findings: RepairFinding[]; noTableRate: Map<string, number> } {
	const { expenses, homeCurrencyOf } = args;

	const ratesOf = new Map<string, RateRow[]>();
	for (const r of args.rates) {
		const list = ratesOf.get(r.currency) ?? [];
		list.push({ type: r.type, rate: r.rate, date: r.date });
		ratesOf.set(r.currency, list);
	}
	const tableRate = (currency: string, date: Date, type?: string | null) =>
		currency === USD
			? 1
			: (pickBestRate(ratesOf.get(currency) ?? [], {
					date,
					preferredType: type,
				})?.rate ?? null);

	// Pass 1: classify the rate of every expense.
	const rateReason = new Map<string, RepairReason>();
	const noTableRate = new Map<string, number>();
	for (const row of expenses) {
		if (row.currency === USD) {
			if (row.exchangeRate !== 1) rateReason.set(row.id, "usd-rate");
			continue;
		}
		const table = tableRate(row.currency, row.date, row.pricingSource);
		if (table === null) {
			noTableRate.set(row.currency, (noTableRate.get(row.currency) ?? 0) + 1);
			continue;
		}
		const r = row.exchangeRate;
		if (!isValidRate(r)) {
			rateReason.set(row.id, "implausible");
			continue;
		}
		if (r === 1 && logDistance(table, 1) > Math.log(1.05)) {
			rateReason.set(row.id, "rate-one");
			continue;
		}
		const home = homeCurrencyOf(row.userId);
		const homeRate = tableRate(home, row.date);
		if (home !== USD && home !== row.currency && homeRate !== null) {
			const cross = oldFormCrossRate(row.currency, table, homeRate);
			if (
				logDistance(cross, table) > CROSS_MIN_GAP &&
				logDistance(r, cross) < logDistance(r, table)
			) {
				rateReason.set(row.id, "cross-rate");
				continue;
			}
		}
		if (logDistance(r, table) > Math.log(IMPLAUSIBLE_FACTOR)) {
			rateReason.set(row.id, "implausible");
		}
	}

	// Reference rates: healthy stored rates of the same currency near the date.
	const healthy = new Map<string, RepairExpense[]>();
	for (const row of expenses) {
		if (row.currency === USD || rateReason.has(row.id)) continue;
		const list = healthy.get(row.currency) ?? [];
		list.push(row);
		healthy.set(row.currency, list);
	}
	const referenceRate = (row: RepairExpense): number | null => {
		const near = (healthy.get(row.currency) ?? [])
			.filter(
				(h) =>
					Math.abs(h.date.getTime() - row.date.getTime()) <=
					REFERENCE_WINDOW_MS,
			)
			.map((h) => h.exchangeRate);
		if (near.length >= 3) return median(near);
		return tableRate(row.currency, row.date, row.pricingSource);
	};

	// Pass 2: decide the fix.
	const findings: RepairFinding[] = [];
	for (const row of expenses) {
		const home = homeCurrencyOf(row.userId);
		const reason = rateReason.get(row.id);

		if (row.currency === USD) {
			const usd = roundUSD(row.amount);
			if (reason || Math.abs(usd - row.amountInUSD) > 0.01) {
				findings.push({
					row,
					home,
					reason: reason ?? "usd-amount",
					newRate: 1,
					newUSD: usd,
				});
			}
			continue;
		}

		if (reason) {
			const table = tableRate(row.currency, row.date, row.pricingSource);
			if (
				reason === "implausible" &&
				table !== null &&
				row.amountInUSD > 0 &&
				logDistance(row.amountInUSD, toUSD(row.amount, row.currency, table)) <
					Math.log(IMPLAUSIBLE_FACTOR)
			) {
				findings.push({
					row,
					home,
					reason,
					newRate: rateFromUsdPerUnit(
						row.currency,
						row.amountInUSD / row.amount,
					),
					newUSD: row.amountInUSD,
				});
				continue;
			}
			const ref = referenceRate(row);
			if (ref === null) continue;
			findings.push({
				row,
				home,
				reason,
				newRate: ref,
				newUSD: computeAmountInUSD(row.amount, row.currency, ref),
			});
			continue;
		}

		if (isValidRate(row.exchangeRate) && !usdMatches(row, row.exchangeRate)) {
			findings.push({
				row,
				home,
				reason: "usd-mismatch",
				newRate: row.exchangeRate,
				newUSD: computeAmountInUSD(row.amount, row.currency, row.exchangeRate),
			});
		}
	}

	return { findings, noTableRate };
}
