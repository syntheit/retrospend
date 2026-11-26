/**
 * Planning one recurring period, for the server and a device. The server runs
 * `planConfirm` and `planSkip` inside its transaction over the row it read; a
 * device runs them over its store. Both then write what the plan says, with a
 * compare-and-set on the due date and the stamp (`lostAdvance` answers its lost race).
 *
 * The order of the refusals is today's server order, which the characterization
 * tests pin (a paused template with a stale dueAt is "not found", not a
 * conflict; a period not due answers before a missing amount):
 *   a. the template is absent, another person's, paused, or (an auto post) no
 *      longer pays automatically with a fixed amount: not_found;
 *   b. `dueAt` is given and is not the template's due date: already_posted;
 *   c. a stamp is given and is not the template's version: changed;
 *   d. the period is not due in the request's zone: not_due;
 *   e. (confirm) the paid-on day, then the amount, then the rate.
 * Putting the paused check before the stamp keeps the 404 for a paused
 * template, and `already_posted` before the stamp lets a period another client
 * posted retire instead of park: that post changed the stamp too.
 *
 * `now` and the zones are arguments, never read here. Due dates are checked in
 * the request's `zone` and stepped in the saved `stepZone`.
 */
import type { BookContext, RateChoice } from "../rate-booking";
import {
	dueAnchorDay,
	nextDueAfter,
	type RecurringFrequency,
} from "../recurring";
import { isDue } from "./due";
import {
	type EntryTemplate,
	type RecurringEntryRow,
	recurringEntryRow,
} from "./entry-row";
import { paidOnInstant } from "./paid-on";
import {
	ITEM_ALREADY_SETTLED,
	PAYMENT_ALREADY_CONFIRMED,
	RECURRING_CHANGED,
	RECURRING_NOT_FOUND,
	RecurringRefusal,
} from "./refusals";

/** The template as a plan reads it. */
export interface PostTemplate extends EntryTemplate {
	readonly frequency: RecurringFrequency;
	readonly anchorDay: number | null;
	readonly isActive: boolean;
	readonly autoPay: boolean;
	/**
	 * The version the template was read at, opaque: the server's updatedAt as
	 * text, a device's pulled version. Null on a device-made template until its
	 * first ack, which nothing can name yet.
	 */
	readonly stamp: string | null;
}

interface PlanTiming {
	readonly userId: string;
	readonly now: Date;
	/** The zone "is it due" is read in: the request's, or the saved zone for an auto post. */
	readonly zone: string;
	/** The user's saved zone, which due dates step in whatever zone the request came from. */
	readonly stepZone: string;
	/** The due date being settled; a repeat of the same call is refused. */
	readonly dueAt?: Date | null;
	/** The template version the caller saw; not compared when omitted. */
	readonly expectedStamp?: string | null;
}

export interface ConfirmInput extends PlanTiming {
	/** The real amount as typed, required when the template's amount varies. */
	readonly confirmedAmount?: number | string | null;
	/** The day it was really paid (yyyy-MM-dd); the due date when omitted. */
	readonly paidOn?: string | null;
	readonly choice?: RateChoice;
	/** An auto post: the template must still pay automatically with a fixed amount. */
	readonly auto?: boolean;
}

export type SkipInput = PlanTiming;

export interface ConfirmPlan {
	readonly templateId: string;
	readonly entry: RecurringEntryRow;
	/** The due date this confirm settles: the compare-and-set's expected value, and the undo's. */
	readonly dueAt: Date;
	readonly nextDueDate: Date;
	readonly anchorDay: number;
	/** The anchor before this confirm (null on a legacy template), for the undo. */
	readonly previousAnchorDay: number | null;
}

export interface SkipPlan {
	readonly templateId: string;
	readonly dueAt: Date;
	readonly nextDueDate: Date;
	readonly anchorDay: number;
}

const refuse = (kind: RecurringRefusal["kind"], message: string) =>
	new RecurringRefusal(kind, message);

/** Steps a to c, which confirm and skip share; `auto` adds the auto-post part of a. */
function checkTemplate(
	template: PostTemplate | null,
	input: PlanTiming,
	settled: string,
	auto: boolean,
): asserts template is PostTemplate {
	if (
		!template ||
		template.userId !== input.userId ||
		!template.isActive ||
		(auto && (!template.autoPay || template.amountMode !== "FIXED"))
	)
		throw refuse("not_found", RECURRING_NOT_FOUND);
	if (input.dueAt && input.dueAt.getTime() !== template.nextDueDate.getTime())
		throw refuse("already_posted", settled);
	if (
		input.expectedStamp !== undefined &&
		input.expectedStamp !== null &&
		input.expectedStamp !== template.stamp
	)
		throw refuse("changed", RECURRING_CHANGED);
}

export async function planConfirm(
	template: PostTemplate | null,
	input: ConfirmInput,
	book: BookContext,
): Promise<ConfirmPlan> {
	checkTemplate(template, input, PAYMENT_ALREADY_CONFIRMED, !!input.auto);
	// Either direction reads the start of the next day here, as it always has;
	// an income template's own skip reads its UTC day (planSkip).
	if (!isDue(template.nextDueDate, input.now, input.zone, "start_of_next_day"))
		throw refuse("not_due", PAYMENT_ALREADY_CONFIRMED);
	const entry = await recurringEntryRow(
		template,
		{
			confirmedAmount: input.confirmedAmount,
			choice: input.choice,
			paidOn: input.paidOn
				? paidOnInstant(
						input.paidOn,
						template.direction,
						input.zone,
						template,
						input.now,
					)
				: undefined,
		},
		book,
	);
	return {
		templateId: template.id,
		entry,
		dueAt: template.nextDueDate,
		nextDueDate: nextDueAfter(template, template.nextDueDate, input.stepZone),
		anchorDay: dueAnchorDay(template, input.stepZone),
		previousAnchorDay: template.anchorDay,
	};
}

export function planSkip(
	template: PostTemplate | null,
	input: SkipInput,
): SkipPlan {
	checkTemplate(template, input, ITEM_ALREADY_SETTLED, false);
	// Income is due by its UTC day, an expense by its instant. Confirm reads an
	// income template by its instant too; the two are not unified here.
	const rule = template.direction === "IN" ? "utc_day" : "start_of_next_day";
	if (!isDue(template.nextDueDate, input.now, input.zone, rule))
		throw refuse("not_due", ITEM_ALREADY_SETTLED);
	return {
		templateId: template.id,
		dueAt: template.nextDueDate,
		nextDueDate: nextDueAfter(template, template.nextDueDate, input.stepZone),
		anchorDay: dueAnchorDay(template, input.stepZone),
	};
}

const settledMessage = (call: "confirm" | "skip") =>
	call === "confirm" ? PAYMENT_ALREADY_CONFIRMED : ITEM_ALREADY_SETTLED;

/**
 * What a write that named a template stamp answers when its compare-and-set
 * (due date and stamp) matched no row, given the row read again afterwards
 * (null: it is gone). The same order as the plans: gone, then a moved due
 * date (already posted), then a moved stamp (changed). The one owner, so an
 * edit that commits between a plan's read and its write is `changed`, never a
 * booking from the old template.
 */
export function lostAdvance(
	call: "confirm" | "skip",
	now: { readonly nextDueDate: Date; readonly stamp: string | null } | null,
	dueAt: Date,
	expectedStamp: string | null | undefined,
): RecurringRefusal {
	if (!now) return refuse("not_found", RECURRING_NOT_FOUND);
	if (now.nextDueDate.getTime() !== dueAt.getTime())
		return refuse("already_posted", settledMessage(call));
	if (expectedStamp && expectedStamp !== now.stamp)
		return refuse("changed", RECURRING_CHANGED);
	return refuse("already_posted", settledMessage(call));
}

/** Periods one template posts in one run; a template years behind continues next run. */
export const CATCH_UP_CAP = 31;

export interface CatchUpPeriod {
	/** The due date being posted. */
	readonly dueAt: Date;
	/** 0 for the first period of the run. */
	readonly index: number;
}

/** What posting one period came to; `outcome` is the port's own word for why it did not. */
export type PeriodResult<O> =
	| { readonly posted: true; readonly nextDueDate: Date }
	| { readonly posted: false; readonly outcome: O };

export interface CatchUpPort<O> {
	/**
	 * Posts one period of the template as it stands now, as an auto post: it
	 * re-reads the template, so a pause or an auto-pay switched off since the
	 * last period is seen. A refusal or an error is reported, never thrown.
	 */
	post(period: CatchUpPeriod): Promise<PeriodResult<O>>;
	/** Whether the account is protected now. A read that fails counts as protected. */
	isProtected(): Promise<boolean>;
}

/**
 * - `caught_up`: the next due date is after now (or the first one already was).
 * - `refused`: a period did not post (its result is the last one); nothing
 *   after it is tried, so a missing rate on period k leaves k+1 on unposted.
 * - `protected`: protection turned on before a later period.
 * - `protection_unreadable`: the protection read failed, which counts as
 *   protected (fail closed) but is its own reason, so a caller can log it.
 * - `cap`: CATCH_UP_CAP periods posted and more are still due.
 */
export type CatchUpStop =
	| "caught_up"
	| "refused"
	| "protected"
	| "protection_unreadable"
	| "cap";

export interface CatchUpRun<O> {
	readonly results: readonly PeriodResult<O>[];
	readonly stopped: CatchUpStop;
}

/** What a protection read says; a failed read is `unreadable`, never `off`. */
export type ProtectionRead = "on" | "off" | "unreadable";

export async function readProtection(
	isProtected: () => Promise<boolean>,
): Promise<ProtectionRead> {
	try {
		return (await isProtected()) ? "on" : "off";
	} catch {
		return "unreadable";
	}
}

/** The stop a protection read gives, or null when it is off. */
export function protectionStop(
	read: ProtectionRead,
): "protected" | "protection_unreadable" | null {
	return read === "off"
		? null
		: read === "on"
			? "protected"
			: "protection_unreadable";
}

/**
 * Posts every due period of one template, oldest first, each at its own due
 * date: the due instant gate (`due <= now`), the protection read before every
 * period after the first (the caller read it before the first), the stop at
 * the first period that does not post, and the cap. A due date is posted by
 * the port, one write per period, so a failure leaves the earlier ones booked.
 */
export async function runCatchUp<O>(
	port: CatchUpPort<O>,
	firstDue: Date,
	now: Date,
): Promise<CatchUpRun<O>> {
	const results: PeriodResult<O>[] = [];
	let due = firstDue;
	if (due > now) return { results, stopped: "caught_up" };
	for (let index = 0; index < CATCH_UP_CAP; index++) {
		const stop =
			index > 0
				? protectionStop(await readProtection(() => port.isProtected()))
				: null;
		if (stop) return { results, stopped: stop };
		const result = await port.post({ dueAt: due, index });
		results.push(result);
		if (!result.posted) return { results, stopped: "refused" };
		if (result.nextDueDate > now) return { results, stopped: "caught_up" };
		due = result.nextDueDate;
	}
	return { results, stopped: "cap" };
}
