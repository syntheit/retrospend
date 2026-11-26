/**
 * Recurring confirm, skip and catch-up on the device: the writes the server
 * runs through the domain's plan-post core (recurring-post/plan.ts), here over
 * the store. The core owns every rule and its order (what is due and in which
 * zone, the paid-on day, the amount, the rate, the step to the next due date),
 * and `recurringEntryRow` owns the posted row. This file is the port: the
 * template read from the store, the title from its name, the rows written.
 *
 * - The device's saved zone is `SettingsRow.timeZone`, never the phone's own:
 *   due dates are read and stepped in it. A person's confirm may name another
 *   request zone for the "is it due" check, as the server's does.
 * - `now` is an argument. Nothing here reads the clock.
 * - The core's refusals (RecurringRefusal, RecurringInputRefusal) and a
 *   missing rate (MissingRateError) reach the caller as they are: the queue
 *   needs the kind (already posted retires, not due waits, changed parks).
 *   The core's compare-and-set on the due date has nothing to guard here, as
 *   a store transaction is one writer.
 * - Recurring income is not on the device until M4: it is refused, never
 *   posted. The poster plans none either.
 * - After a write the template has no version, as a booked expense has none,
 *   until the server's answer names one.
 *
 * Run through LocalDb.write or LocalDb.preview, or the preview runner
 * (preview.ts). A write's undo token reverts the expense and the template
 * together, and only while both are as the write left them.
 */
import { MissingRateError } from "@retrospend/domain/money";
import { dec } from "@retrospend/domain/precise-decimal";
import type { RateChoice } from "@retrospend/domain/rate-booking";
import {
	type CatchUpStop,
	type PostTemplate,
	planConfirm,
	planSkip,
	protectionStop,
	readProtection,
	runCatchUp,
} from "@retrospend/domain/recurring-post/plan";
import {
	RECURRING_NOT_FOUND,
	RecurringRefusal,
	type RecurringRefusalKind,
} from "@retrospend/domain/recurring-post/refusals";
import { rateBookOf, refusing } from "./expense-create";
import type { ExpenseRow } from "./expenses";
import type { WriteFn } from "./local-db";
import { InvalidInputError } from "./port";
import { categoryKindOf } from "./reference";
import type { Repos } from "./repos";
import type { TemplateRow } from "./templates";

export const RECURRING_CONFIRM = "recurring.confirm";
export const RECURRING_SKIP = "recurring.skip";
export const RECURRING_CATCH_UP = "recurring.catchUp";

export const INCOME_NOT_ON_DEVICE = "Recurring income is confirmed online";

/** One person owns every row on a device, so the core's own-row check is always met. */
const DEVICE_USER = "device";

/** What a confirm or a skip names. */
interface PeriodInput {
	readonly templateId: string;
	readonly now: Date;
	/** The zone "is it due" is read in; the saved zone when absent. */
	readonly zone?: string;
	/** The due date being settled; a period already settled is refused. */
	readonly dueAt?: Date;
	/** The template version the caller saw (its `version`); not compared when absent. */
	readonly expectedVersion?: string | null;
}

export type SkipRecurringInput = PeriodInput;

export interface ConfirmRecurringInput extends PeriodInput {
	/** The id of the posted expense, client-made so the server row can meet it. */
	readonly clientId: string;
	/** The real amount as typed: required for an "Amount varies" template, refused for a fixed one. */
	readonly confirmedAmount?: number | string;
	/** The day it was really paid (yyyy-MM-dd); the due date when absent. */
	readonly paidOn?: string;
	readonly choice?: RateChoice;
	/** An auto post: the template must still pay automatically with a fixed amount. */
	readonly auto?: boolean;
}

export interface ConfirmedRecurring {
	readonly expense: ExpenseRow;
	readonly template: TemplateRow;
}

/** The template as the core reads it, with the version as its stamp. */
function postTemplateOf(row: TemplateRow): PostTemplate {
	return {
		id: row.id,
		userId: DEVICE_USER,
		amount: dec(row.amount).toFixed(),
		currency: row.currency,
		categoryId: row.categoryId ?? null,
		nextDueDate: row.nextDueDate,
		direction: row.direction,
		amountMode: row.amountMode === "ASK" ? "ASK" : "FIXED",
		frequency: row.frequency,
		anchorDay: row.anchorDay,
		isActive: row.isActive,
		autoPay: row.autoPay,
		stamp: row.version,
	};
}

/** The stored template; one that is absent is the core's own "not found". */
function loadTemplate(r: Repos, id: string): TemplateRow {
	const row = r.recurringTemplates.get(id);
	if (!row) throw new RecurringRefusal("not_found", RECURRING_NOT_FOUND);
	if (row.direction === "IN") throw new InvalidInputError(INCOME_NOT_ON_DEVICE);
	return row;
}

function timingOf(r: Repos, input: PeriodInput) {
	const saved = r.settings.require().timeZone;
	return {
		userId: DEVICE_USER,
		now: input.now,
		zone: input.zone ?? saved,
		stepZone: saved,
		dueAt: input.dueAt ?? null,
		expectedStamp: input.expectedVersion ?? null,
	};
}

/** The template one period on: the due date and anchor the plan says, with no version until the ack. */
const advanced = (
	row: TemplateRow,
	plan: { nextDueDate: Date; anchorDay: number },
): TemplateRow => ({
	...row,
	nextDueDate: new Date(plan.nextDueDate.getTime()),
	anchorDay: plan.anchorDay,
	version: null,
});

async function confirmIn(
	r: Repos,
	input: ConfirmRecurringInput,
): Promise<ConfirmedRecurring> {
	const row = loadTemplate(r, input.templateId);
	const plan = await refusing(() =>
		planConfirm(
			postTemplateOf(row),
			{
				...timingOf(r, input),
				confirmedAmount: input.confirmedAmount,
				paidOn: input.paidOn,
				choice: input.choice,
				auto: input.auto,
			},
			rateBookOf(r),
		),
	);
	const e = plan.entry;
	const expense: ExpenseRow = {
		id: input.clientId,
		status: e.status,
		direction: e.direction,
		entryKind: "STANDARD",
		inType: e.inType,
		isAmortizedParent: false,
		excludeFromAnalytics: e.excludeFromAnalytics,
		categoryKind: categoryKindOf(e.categoryId, (id) => r.categories.get(id)),
		categoryId: e.categoryId,
		date: new Date(e.date.getTime()),
		currency: e.currency,
		amount: e.amount,
		amountInUSD: e.amountInUSD,
		homeCurrency: e.homeCurrency,
		homeAmount: e.homeAmount,
		// The title is the template's name, which only the store holds.
		title: row.name,
		description: null,
		location: null,
		pricingSource: e.pricingSource,
		exchangeRate: e.exchangeRate,
		rateType: e.rateType,
		homeRate: e.homeRate,
		recurringTemplateId: e.recurringTemplateId,
		version: null,
	};
	const template = advanced(row, plan);
	r.expenses.create({ expense, shares: [] });
	r.recurringTemplates.update(template);
	return { expense, template };
}

/** One due period posted: the expense and the template one period on. */
export function confirmRecurring(
	input: ConfirmRecurringInput,
): WriteFn<ConfirmedRecurring> {
	return (r) => confirmIn(r, input);
}

/** One due period skipped: the template one period on, nothing booked. */
export function skipRecurring(input: SkipRecurringInput): WriteFn<TemplateRow> {
	return async (r) => {
		const row = loadTemplate(r, input.templateId);
		const plan = planSkip(postTemplateOf(row), timingOf(r, input));
		const template = advanced(row, plan);
		r.recurringTemplates.update(template);
		return template;
	};
}

export interface CatchUpRecurringInput {
	readonly templateId: string;
	readonly now: Date;
	/** The id of the expense posted for the period at `index`, from 0. */
	readonly clientId: (index: number) => string;
	/** Whether the account is protected now; a read that fails counts as protected. */
	readonly isProtected: () => Promise<boolean>;
}

export interface CaughtUp {
	/** The expenses posted, oldest period first. */
	readonly posted: readonly ExpenseRow[];
	readonly stopped: CatchUpStop;
	/** Why the period after the last one did not post, when `stopped` is `refused`. */
	readonly refusal?: RecurringRefusalKind | "missing_rate";
}

/**
 * Every due period of one template, oldest first, each as an auto confirm at
 * its own due date, through the core's `runCatchUp` (its due instant gate,
 * protection read, stop at the first period that does not post, and cap).
 * A missing rate on period k leaves k and everything after it unposted.
 */
export function catchUpRecurring(
	input: CatchUpRecurringInput,
): WriteFn<CaughtUp> {
	return async (r) => {
		const row = loadTemplate(r, input.templateId);
		const first = protectionStop(await readProtection(input.isProtected));
		if (first) return { posted: [], stopped: first };
		const posted: ExpenseRow[] = [];
		const run = await runCatchUp<RecurringRefusalKind | "missing_rate">(
			{
				isProtected: input.isProtected,
				post: async ({ dueAt, index }) => {
					try {
						const done = await confirmIn(r, {
							templateId: input.templateId,
							now: input.now,
							clientId: input.clientId(index),
							dueAt,
							auto: true,
						});
						posted.push(done.expense);
						return { posted: true, nextDueDate: done.template.nextDueDate };
					} catch (error) {
						if (error instanceof RecurringRefusal)
							return { posted: false, outcome: error.kind };
						if (error instanceof MissingRateError)
							return { posted: false, outcome: "missing_rate" };
						throw error;
					}
				},
			},
			row.nextDueDate,
			input.now,
		);
		const last = run.results.at(-1);
		return {
			posted,
			stopped: run.stopped,
			...(last && !last.posted && { refusal: last.outcome }),
		};
	};
}
