import {
	type PutBody,
	putBodyOf,
} from "@retrospend/domain/expense-write/put-body";
import { EditRefusal } from "@retrospend/domain/expense-write/refusals";
import { dec } from "@retrospend/domain/precise-decimal";
import { type Reader, SETTINGS_ID } from "../port";

// A parked edit that met another device's change is saved again over the row
// a pull brought (Try again). This reads that row from the store, as pulled,
// with no pending write laid over it, and turns it into the PUT body through
// the domain's one owner of that step (putBodyOf), in the account's zone.

/** The body that saves the pulled row again, and the version it is checked against. */
export interface Rebase {
	body: PutBody & { id: string };
	version: string;
}

const text = (v: { toString(): string } | null | undefined) =>
	v === null || v === undefined ? null : dec(v).toFixed();

/**
 * Null when the row is not in the store, has no version or no booked rate
 * (a row the device booked itself), or the domain refuses a body for it (a
 * spread parent, a typed rate from another home): never guessed.
 */
export function rebaseOf(r: Reader, id: string): Rebase | null {
	const row = r.get("expenses", id);
	const settings = r.get("settings", SETTINGS_ID);
	if (
		!row ||
		!settings ||
		row.version === null ||
		row.exchangeRate === undefined ||
		row.pricingSource === undefined
	)
		return null;
	try {
		const body = putBodyOf(
			{
				title: row.title ?? "",
				amount: dec(row.amount).toFixed(),
				currency: row.currency,
				date: row.date,
				categoryId: row.categoryId ?? null,
				location: row.location ?? null,
				description: row.description ?? null,
				excludeFromAnalytics: row.excludeFromAnalytics,
				isAmortizedParent: row.isAmortizedParent,
				exchangeRate: dec(row.exchangeRate).toFixed(),
				pricingSource: row.pricingSource,
				rateType: row.rateType ?? null,
				homeRate: text(row.homeRate),
				homeCurrency: row.homeCurrency,
			},
			settings.timeZone,
			settings.homeCurrency,
		);
		return { body: { id, ...body }, version: row.version };
	} catch (error) {
		if (error instanceof EditRefusal) return null;
		throw error;
	}
}
