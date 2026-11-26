/**
 * Update balance (MONEY-MOVES §2.1, §4.6) as pure rows: from what the account
 * holds, the balance the person typed, the rate and the day, the Not logged
 * leg for the difference, the account's new columns and the day's snapshot.
 * It keeps the sign the user typed (T3-7). The caller loads the rows and
 * writes them; the rate is a Decimal string, never a float.
 */
import { columnText, MissingRateError, toUSDDec } from "../money-dec";
import { type Decimal, type DecimalInput, dec } from "../precise-decimal";
import { bookHome } from "./book-home";
import { type AssetType, cappedCounted, worthOf } from "./places";
import { type SnapshotPlan, snapshotPlan } from "./snapshot-plan";
import type { RatePick } from "./valuation";

export interface CheckpointAccount {
	readonly type: AssetType;
	readonly currency: string;
	readonly balance: DecimalInput;
	readonly countedUnits: DecimalInput;
}

/** The difference the typed balance makes, in what you have (a liability's balance counts against you). */
export function checkpointDifference(
	account: Pick<CheckpointAccount, "type" | "balance">,
	typed: DecimalInput,
): Decimal {
	return worthOf(account.type, dec(typed).sub(dec(account.balance)));
}

export interface CheckpointPlanInput {
	readonly account: CheckpointAccount;
	/** The balance the person typed, in the account's currency. */
	readonly balance: DecimalInput;
	/** The account's rate as a Decimal string (units per USD, USD per coin) and its type. */
	readonly rate: { readonly rate: string; readonly rateType: string | null };
	/** The calendar day, a UTC midnight. */
	readonly day: Date;
	readonly homeCurrency: string;
	/**
	 * Rates to book the leg's home value; null when none were loaded, which
	 * is allowed only when the balance is already right (no leg is written).
	 */
	readonly pick: RatePick | null;
	readonly recordedAt: Date;
}

export interface CheckpointPlan {
	readonly before: Decimal;
	readonly after: Decimal;
	/** In the account's currency; zero means no leg. */
	readonly notLogged: Decimal;
	/** The BALANCE_UPDATE leg; null when the balance was already right. */
	readonly leg: {
		readonly currency: string;
		readonly amount: string;
		/** Null when no rate exists to book it. */
		readonly homeAmount: string | null;
		readonly homeCurrency: string | null;
		readonly date: Date;
		readonly source: "BALANCE_UPDATE";
	} | null;
	/** The account's new columns. */
	readonly account: {
		readonly balance: string;
		readonly countedUnits: string;
		readonly exchangeRate: string;
		readonly exchangeRateType: string | null;
	};
	readonly snapshot: SnapshotPlan;
}

export function checkpointPlan(input: CheckpointPlanInput): CheckpointPlan {
	const { account, rate } = input;
	const after = dec(input.balance);
	const before = dec(account.balance);
	const notLogged = checkpointDifference(account, after);
	let leg: CheckpointPlan["leg"] = null;
	if (!notLogged.isZero()) {
		if (!input.pick) throw new MissingRateError(account.currency);
		const home = bookHome(
			input.pick,
			{
				currency: account.currency,
				account: {
					currency: account.currency,
					exchangeRateType: rate.rateType,
					exchangeRate: rate.rate,
				},
			},
			notLogged,
			input.homeCurrency,
			input.day,
		);
		leg = {
			currency: account.currency,
			amount: notLogged.toString(),
			homeAmount: home?.amount.toString() ?? null,
			homeCurrency: home?.currency ?? null,
			date: input.day,
			source: "BALANCE_UPDATE",
		};
	}
	return {
		before,
		after,
		notLogged,
		leg,
		account: {
			balance: after.toString(),
			countedUnits: cappedCounted(
				account.type,
				dec(account.countedUnits),
				after,
			).toString(),
			exchangeRate: columnText(rate.rate, 6),
			exchangeRateType: rate.rateType,
		},
		snapshot: snapshotPlan({
			day: input.day,
			units: after,
			usd: toUSDDec(after, account.currency, rate.rate),
			meta: {
				currency: account.currency,
				type: account.type,
				exchangeRateType: rate.rateType,
			},
			recordedAt: input.recordedAt,
		}),
	};
}
