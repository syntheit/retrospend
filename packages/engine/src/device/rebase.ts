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
 * A recurring template as a pull left it, read for a parked write of it: not
 * there, or there with whether it is paused, whether its next due date is past
 * the period the write named (`dueAt`: that period was posted, skipped or
 * moved), and whether the expense the write named (`expenseId`, the confirm's
 * client id) is in the store as an expense of the template. The id is the
 * exact proof: a confirm paid on another day books on that day, not on `dueAt`.
 * `autoPay` is its auto-pay setting (with `amountMode`, whether an auto post
 * is still allowed). `version` is the template's `updatedAt` as pulled, the stamp Try again checks
 * the re-based write against (null for a template the device made itself).
 */
export type TemplateSeen =
	| { found: false }
	| {
			found: true;
			paused: boolean;
			passed: boolean;
			posted: boolean;
			version: string | null;
			currency: string;
			amountMode: "FIXED" | "ASK";
			autoPay: boolean;
	  };

export function templateSeenOf(
	r: Reader,
	id: string,
	dueAt: Date,
	expenseId: string,
): TemplateSeen {
	const row = r.get("recurringTemplates", id);
	if (!row) return { found: false };
	const due = dueAt.getTime();
	return {
		found: true,
		paused: !row.isActive,
		passed: row.nextDueDate.getTime() > due,
		posted: r.get("expenses", expenseId)?.recurringTemplateId === id,
		version: row.version,
		currency: row.currency,
		amountMode: row.amountMode === "ASK" ? "ASK" : "FIXED",
		autoPay: row.autoPay,
	};
}

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

/**
 * An account as a pull left it, read for a parked write of it: its version
 * and stored balance (what Try again names as the version and balance it saw)
 * and whether it is closed.
 */
export interface AccountSeen {
	version: number;
	balance: string;
	closed: boolean;
}

export function accountSeenOf(r: Reader, id: string): AccountSeen | null {
	const row = r.get("accounts", id);
	return row
		? {
				version: row.version,
				balance: row.balance,
				closed: row.closedAt !== null,
			}
		: null;
}
