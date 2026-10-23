/**
 * The Add family's server results as Money (minor units) for the client,
 * which only formats (R9). A rate is a pair of amounts: "USD 1 = ARS 1,468"
 * is `{ unit: USD 1, value: ARS 1,468 }`, rounded to the quote's minor unit
 * for display only (the booked rate keeps its 12 decimals on the row).
 */
import type { Money } from "~/server/figures/registry";
import type { AccountChange } from "../accounts/ledger";
import { dec, toMinor } from "../envelope/units";
import type { RateOptions } from "../rate-types";
import type { TransferValue } from "../transfers/create.mutation";

export interface RatePair {
	readonly unit: Money;
	readonly value: Money;
}

const money = (amount: string, currency: string): Money => ({
	minor: toMinor(dec(amount), currency),
	currency,
});

export function ratePair(base: string, quote: string, value: string): RatePair {
	return { unit: money("1", base), value: money(value, quote) };
}

export interface RateOptionView {
	readonly rateType: string;
	readonly rate: RatePair;
	/** The amount asked, booked at this type; null when none was asked. */
	readonly home: Money | null;
}

export interface RateOptionsView {
	readonly homeCurrency: string;
	readonly defaultType: string | null;
	readonly options: readonly RateOptionView[];
	/** No rate at all for the pair: saving is blocked (a missing rate is never 1). */
	readonly missing: { currency: string } | null;
}

export function rateOptionsView(
	currency: string,
	o: RateOptions,
): RateOptionsView {
	const home = o.homeCurrency;
	return {
		homeCurrency: home,
		defaultType: o.defaultType,
		missing: o.missing,
		options: o.options.map((x) => ({
			rateType: x.rateType,
			rate: ratePair(currency, home, x.homeRate),
			home: x.homeAmount === null ? null : money(x.homeAmount, home),
		})),
	};
}

export interface AccountChangeView {
	readonly accountId: string;
	readonly name: string;
	readonly before: Money;
	readonly after: Money;
}

const accountView = (a: AccountChange): AccountChangeView => ({
	accountId: a.accountId,
	name: a.name,
	before: money(a.before, a.currency),
	after: money(a.after, a.currency),
});

export interface TransferView {
	readonly transferId: string;
	readonly kind: TransferValue["kind"];
	readonly from: Money;
	readonly to: Money;
	/** Exchange: the rate the two typed amounts make. */
	readonly rate: RatePair | null;
	/** Against the reference rate in home: negative = less than the reference. */
	readonly vsReference: Money | null;
	readonly referenceRateType: string | null;
	readonly accounts: readonly AccountChangeView[];
	readonly budget: TransferValue["budget"];
	readonly feeExpenseId: string | null;
}

export function transferView(v: TransferValue): TransferView {
	return {
		transferId: v.transferId,
		kind: v.kind,
		from: money(v.fromAmount, v.fromCurrency),
		to: money(v.toAmount, v.toCurrency),
		rate: v.rate && ratePair(v.rate.base, v.rate.quote, v.rate.value),
		vsReference: v.vsReference,
		referenceRateType: v.referenceRateType,
		accounts: v.accounts.map(accountView),
		budget: v.budget,
		feeExpenseId: v.feeExpenseId,
	};
}
