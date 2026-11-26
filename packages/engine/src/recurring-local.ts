/**
 * Recurring confirm and skip on the device: the writes the server
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
 * - A run of due periods is never one write. The poster plans the periods
 *   (`planPosterOver`) and each one is its own `confirmRecurring`, so each
 *   has its own id, due date, stamp, ack and undo, as the server's confirms do.
 * - After a write the template has no version, as a booked expense has none,
 *   until the server's answer names one.
 *
 * Run through LocalDb.write or LocalDb.preview, or the preview runner
 * (preview.ts). A write's undo token reverts the expense and the template
 * together, and only while both are as the write left them.
 */
import { dec } from "@retrospend/domain/precise-decimal";
import type { RateChoice } from "@retrospend/domain/rate-booking";
import {
	type PostTemplate,
	planConfirm,
	planSkip,
} from "@retrospend/domain/recurring-post/plan";
import {
	type PosterRun,
	planPosterRun,
} from "@retrospend/domain/recurring-post/poster";
import {
	RECURRING_NOT_FOUND,
	RecurringRefusal,
} from "@retrospend/domain/recurring-post/refusals";
import { rateBookOf, refusing } from "./expense-create";
import type { ExpenseRow } from "./expenses";
import type { WriteFn } from "./local-db";
import { InvalidInputError } from "./port";
import { categoryKindOf } from "./reference";
import type { ReadRepos, Repos } from "./repos";
import type { TemplateRow } from "./templates";

export const RECURRING_CONFIRM = "recurring.confirm";
export const RECURRING_SKIP = "recurring.skip";

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
export function loadTemplate(r: Repos, id: string): TemplateRow {
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

export interface PosterPlanInput {
	readonly templateId: string;
	readonly now: Date;
	/** The server's auto-post setting: off means nothing posts on its own. */
	readonly autoPost: boolean;
	/** Whether the account is protected now; a read that fails counts as protected. */
	readonly isProtected: () => Promise<boolean>;
}

/**
 * The domain poster's plan (`planPosterRun`) for one template over the store
 * as last pulled: one entry per due period, each to be queued as one
 * `confirmRecurring` with `auto: true`, that entry's `dueAt` and, for the
 * first entry, its stamp as `expectedVersion`. A later entry's stamp is
 * `{ after }`: the version an earlier entry's ack names, which a device write
 * cannot know. Nothing is written here and the loop is the domain's.
 */
export function planPosterOver(
	r: Pick<ReadRepos, "recurringTemplates" | "settings" | "rates">,
	input: PosterPlanInput,
): Promise<PosterRun> {
	const row = r.recurringTemplates.get(input.templateId);
	const zone = r.settings.require().timeZone;
	return planPosterRun({
		userId: DEVICE_USER,
		template: row ? postTemplateOf(row) : null,
		autoPost: input.autoPost,
		now: input.now,
		zone,
		book: rateBookOf(r),
		isProtected: input.isProtected,
	});
}
