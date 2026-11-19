/**
 * A stored expense row as the body of PUT /expenses/{id}: what the phone's
 * Try again sends to re-base an edit over the row a pull brought. One owner
 * for it, so the day, the rate and the cleared fields cannot drift between
 * the phone and the server's own undo, which reads the same rate fields
 * through rateInputOf.
 */
import { dec } from "../precise-decimal";
import { CUSTOM_RATE_TYPE } from "../rate-booking";
import { dayKey } from "../time-zone";
import type { StoredExpense } from "./edit";
import {
	EditRefusal,
	bookedInOtherHome,
	otherHomeMessage,
	SPREAD_NOT_ON_DEVICE,
} from "./refusals";

/** The rate fields that book `row`'s rate again: a typed rate stays typed, else its type. */
export function rateInputOf(row: {
	currency: string;
	exchangeRate: { toString(): string };
	pricingSource: string | null;
	rateType: string | null;
	homeRate: { toString(): string } | null;
	homeCurrency: string | null;
}): {
	exchangeRate?: number;
	pricingSource?: string;
	rateType?: string;
	customRate?: { base: string; value: string; home?: string };
} {
	if (row.rateType === CUSTOM_RATE_TYPE && row.homeRate) {
		return {
			customRate: {
				base: row.currency,
				// Plain decimal text (toFixed never writes an exponent), every stored digit.
				value: dec(row.homeRate).toFixed(),
				...(row.homeCurrency ? { home: row.homeCurrency } : {}),
			},
		};
	}
	return {
		exchangeRate: Number(row.exchangeRate.toString()),
		...(row.pricingSource === null ? {} : { pricingSource: row.pricingSource }),
		...(row.rateType ? { rateType: row.rateType } : {}),
	};
}

/** The PUT body's fields; a field left out is cleared by the server. */
export interface PutBody {
	title: string;
	amount: string;
	currency: string;
	/** YYYY-MM-DD in the send's zone. */
	date: string;
	categoryId?: string;
	rateType?: string;
	/** 1 unit of `currency` is this many units of home. */
	customRate?: string;
	location?: string;
	description?: string;
	excludeFromAnalytics: boolean;
}

/**
 * The full body that saves `row` again. The day is the row's day in `zone`,
 * the zone the request is sent from (the server reads the body's day in it).
 * A spread parent has no body: PUT without `amortizeOver` would remove its
 * parts, and the device does not spread. A typed rate was quoted into the
 * home it was booked in; sent after the home changed it would read as a rate
 * into the new `home`, so it is refused, as the server refuses it.
 */
export function putBodyOf(
	row: Pick<
		StoredExpense,
		| "title"
		| "amount"
		| "currency"
		| "date"
		| "categoryId"
		| "location"
		| "description"
		| "excludeFromAnalytics"
		| "isAmortizedParent"
		| "exchangeRate"
		| "pricingSource"
		| "rateType"
		| "homeRate"
		| "homeCurrency"
	>,
	zone: string,
	home: string,
): PutBody {
	if (row.isAmortizedParent)
		throw new EditRefusal("badRequest", SPREAD_NOT_ON_DEVICE);
	const rate = rateInputOf(row);
	const booked = rate.customRate?.home;
	if (bookedInOtherHome(booked, home))
		throw new EditRefusal("badRequest", otherHomeMessage(booked));
	return {
		title: row.title,
		amount: dec(row.amount).toFixed(),
		currency: row.currency,
		date: dayKey(row.date, zone),
		...(row.categoryId ? { categoryId: row.categoryId } : {}),
		...(rate.customRate
			? { customRate: rate.customRate.value }
			: rate.rateType
				? { rateType: rate.rateType }
				: {}),
		...(row.location ? { location: row.location } : {}),
		...(row.description ? { description: row.description } : {}),
		excludeFromAnalytics: row.excludeFromAnalytics,
	};
}
