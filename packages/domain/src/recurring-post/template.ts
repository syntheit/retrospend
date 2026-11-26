/**
 * The rules for a recurring template itself: which day it anchors to, the
 * instant a typed day is stored as, which category kind it may hold, what a
 * new template starts with and what an edit changes. The server's
 * `createTemplate` and `updateTemplate` and a device's template writes all
 * call these, so none of them re-states a rule.
 *
 * The zone is an argument, never read here: it is the user's SAVED zone, the
 * zone every step reads the stored instant in. A due day is a calendar date,
 * so the zone of the request that typed it does not move it.
 */
import { CategoryNotFoundError } from "../expense-write/refusals";
import type { RecurringFrequency } from "../recurring";
import { parseDateOnlyIn } from "../time-zone";
import {
	ANCHOR_MISMATCH,
	ANCHOR_OUT_OF_RANGE,
	RecurringInputRefusal,
} from "./refusals";

export type TemplateDirection = "OUT" | "IN";
export type TemplateAmountMode = "FIXED" | "ASK";

/** Frequencies that step by months and so keep a day of month. */
const MONTH_BASED: readonly RecurringFrequency[] = [
	"MONTHLY",
	"QUARTERLY",
	"YEARLY",
];

/** The day of month a typed YYYY-MM-DD day is. */
export const anchorOf = (day: string): number => Number(day.slice(8, 10));

/**
 * The stored due instant for a typed day. Recurring income keeps its day as
 * UTC midnight, which is how the income code reads it; an expense template
 * keeps the start of the day in the saved zone.
 */
export function dueInstant(
	day: string,
	direction: TemplateDirection,
	timeZone: string,
): Date {
	return direction === "IN"
		? new Date(`${day}T00:00:00.000Z`)
		: parseDateOnlyIn(day, timeZone);
}

/** The category kind a template of this direction may hold. */
export const templateCategoryKind = (direction: TemplateDirection) =>
	direction === "IN" ? "INCOME" : "EXPENSE";

/**
 * Refuses a category that does not exist, is not the person's (the adapter's
 * lookup is scoped to them) or is of the other kind: an expense template needs
 * an expense category and an income one an income category. `found` is the
 * person's category row for the id, or null.
 */
export function checkTemplateCategory(
	found: { readonly kind: string } | null | undefined,
	direction: TemplateDirection,
): void {
	if (found?.kind !== templateCategoryKind(direction))
		throw new CategoryNotFoundError("forbidden");
}

/**
 * The anchor to store. A given `anchorDay` on a month-based schedule wins, but
 * the first date must be that day, or the last day of a month too short for
 * it. Without one, or on a weekly schedule, the anchor is the day typed.
 */
export function resolveAnchor(input: {
	readonly nextDueDate: string;
	readonly frequency: RecurringFrequency;
	readonly anchorDay?: number;
}): number {
	const typed = anchorOf(input.nextDueDate);
	const wanted = input.anchorDay;
	if (wanted === undefined || !MONTH_BASED.includes(input.frequency))
		return typed;
	const [y, m] = input.nextDueDate.split("-").map(Number) as [number, number];
	const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
	if (!Number.isInteger(wanted) || wanted < 1 || wanted > 31)
		throw new RecurringInputRefusal("anchor_out_of_range", ANCHOR_OUT_OF_RANGE);
	if (typed !== Math.min(wanted, last))
		throw new RecurringInputRefusal("anchor_mismatch", ANCHOR_MISMATCH);
	return wanted;
}

/** What a new template is made from. Amounts are decimal strings, as on the wire. */
export interface TemplateInput {
	readonly name: string;
	readonly amount: string;
	readonly currency: string;
	readonly categoryId?: string;
	readonly frequency: RecurringFrequency;
	/** YYYY-MM-DD, the first due day. */
	readonly nextDueDate: string;
	readonly anchorDay?: number;
	readonly direction?: TemplateDirection;
	readonly amountMode?: TemplateAmountMode;
	readonly websiteUrl?: string;
	readonly paymentSource?: string;
	readonly autoPay?: boolean;
}

/** The columns a new template starts with. */
export interface TemplateRow {
	readonly name: string;
	readonly amount: string;
	readonly currency: string;
	readonly categoryId: string | undefined;
	readonly direction: TemplateDirection;
	readonly amountMode: TemplateAmountMode;
	readonly frequency: RecurringFrequency;
	readonly nextDueDate: Date;
	readonly anchorDay: number;
	readonly websiteUrl: string | undefined;
	readonly paymentSource: string | undefined;
	readonly autoPay: boolean;
}

/** Out unless the input says money comes in. */
export const newTemplateDirection = (
	input: Pick<TemplateInput, "direction">,
): TemplateDirection => input.direction ?? "OUT";

/**
 * A new template's columns: out unless said otherwise, a fixed amount, paying
 * automatically, due at the start of the typed day, anchored by `resolveAnchor`.
 */
export function newTemplateRow(
	input: TemplateInput,
	timeZone: string,
): TemplateRow {
	const direction = newTemplateDirection(input);
	return {
		name: input.name,
		amount: input.amount,
		currency: input.currency,
		categoryId: input.categoryId,
		direction,
		amountMode: input.amountMode ?? "FIXED",
		frequency: input.frequency,
		nextDueDate: dueInstant(input.nextDueDate, direction, timeZone),
		anchorDay: resolveAnchor(input),
		websiteUrl: input.websiteUrl,
		paymentSource: input.paymentSource,
		autoPay: input.autoPay ?? true,
	};
}

/**
 * What an edit asks for. A field left out stays; a nullable one set to null
 * is cleared. There is no anchor on an edit: a due date the person sets is the
 * new anchor, and the frequency alone moves neither date nor anchor.
 */
export interface TemplateEdit {
	readonly name?: string;
	readonly amount?: string;
	readonly currency?: string;
	readonly categoryId?: string | null;
	readonly frequency?: RecurringFrequency;
	/** YYYY-MM-DD. */
	readonly nextDueDate?: string;
	readonly amountMode?: TemplateAmountMode;
	readonly websiteUrl?: string | null;
	readonly paymentSource?: string | null;
	readonly autoPay?: boolean;
	readonly isActive?: boolean;
}

/** The columns an edit writes: only those it names. */
export interface TemplatePatch {
	readonly name?: string;
	readonly amount?: string;
	readonly currency?: string;
	readonly categoryId?: string | null;
	readonly frequency?: RecurringFrequency;
	readonly nextDueDate?: Date;
	readonly anchorDay?: number;
	readonly amountMode?: TemplateAmountMode;
	readonly websiteUrl?: string | null;
	readonly paymentSource?: string | null;
	readonly autoPay?: boolean;
	readonly isActive?: boolean;
}

const COPIED = [
	"name",
	"amount",
	"currency",
	"categoryId",
	"frequency",
	"amountMode",
	"websiteUrl",
	"paymentSource",
	"autoPay",
	"isActive",
] as const satisfies readonly (keyof TemplateEdit & keyof TemplatePatch)[];

/**
 * The patch for an edit of a template going `direction`. A due date moves the
 * due instant and sets the anchor to its day, even on a month-end that a short
 * month clamped. An empty due date is no due date.
 */
export function editPatch(
	edit: TemplateEdit,
	direction: TemplateDirection,
	timeZone: string,
): TemplatePatch {
	const patch: { -readonly [K in keyof TemplatePatch]: TemplatePatch[K] } = {};
	for (const key of COPIED) {
		if (edit[key] !== undefined) Object.assign(patch, { [key]: edit[key] });
	}
	if (edit.nextDueDate) {
		patch.nextDueDate = dueInstant(edit.nextDueDate, direction, timeZone);
		patch.anchorDay = anchorOf(edit.nextDueDate);
	}
	return patch;
}
