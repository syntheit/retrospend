/**
 * The Add expense sheet's state as plain data, and the pure steps on it:
 * validation, the split it sends, and the inputs for the entry router. The
 * server books every rate and resolves every split (resolveSplits); this
 * only shapes what the person typed.
 */
import { fromMinor } from "@retrospend/domain/money-minor";
import {
	buildSplitInput,
	type SplitModeKey,
	type SplitRef,
	splitKey,
	splitMembers,
} from "~/lib/shared-split-input";
import type { EntryPerson } from "../types";

export type SpreadChoice = "one" | "2" | "3" | "6" | "12" | "24";
export type CustomBy = "amount" | "pct" | "shares";
export type SplitChoice = "even" | "full" | "custom";

export interface ExpenseDraft {
	/** Set on edit: the personal expense or the shared one. */
	readonly editing: { source: "personal" | "shared"; id: string } | null;
	/** The new expense's id, made once per sheet (Add and new makes another). */
	readonly newId: string;
	readonly currency: string;
	/** The amount as typed; `minor` is its parse, null until it reads as an amount. */
	readonly amountText: string;
	readonly minor: number | null;
	readonly title: string;
	readonly categoryId: string | null;
	/** The person picked a category (auto-pick from the title stops). */
	readonly categoryTouched: boolean;
	readonly date: string;
	/** A table type; null = the pair's default. */
	readonly rateType: string | null;
	readonly custom: boolean;
	readonly customText: string;
	/** The custom rate as a decimal string in home units, when it reads. */
	readonly customRate: string | null;
	readonly projectId: string | null;
	readonly youIncluded: boolean;
	readonly others: readonly EntryPerson[];
	readonly paidBy: SplitRef;
	/** A saved payer with no share stays offered (edit). */
	readonly outsidePayer: EntryPerson | null;
	readonly split: SplitChoice;
	readonly by: CustomBy;
	/** Custom rows in minor units, percent, or share units, keyed by splitKey. */
	readonly exact: Readonly<Record<string, number>>;
	readonly pct: Readonly<Record<string, number>>;
	readonly shares: Readonly<Record<string, number>>;
	readonly spread: SpreadChoice;
	readonly exclude: boolean;
	readonly excludeTouched: boolean;
	readonly excludeAuto: boolean;
	readonly note: string;
	readonly location: string;
}

export type DraftErrors = Partial<
	Record<"amount" | "category" | "rate" | "split", true>
>;

/** Shared when anyone else is on it, or it sits in a project. */
export const isShared = (d: ExpenseDraft) =>
	d.others.length > 0 || d.projectId !== null || d.editing?.source === "shared";

export const isForeign = (d: ExpenseDraft, home: string) => d.currency !== home;

/** Major units of a minor amount, as the shared service takes them. */
const major = (minor: number, currency: string) =>
	Number(fromMinor({ minor, currency }));

export function splitStateOf(d: ExpenseDraft, you: SplitRef) {
	const mode: SplitModeKey =
		d.split !== "custom"
			? "EQUAL"
			: d.by === "amount"
				? "EXACT"
				: d.by === "pct"
					? "PERCENTAGE"
					: "SHARES";
	const exact = Object.fromEntries(
		Object.entries(d.exact).map(([k, m]) => [k, major(m, d.currency)]),
	);
	return {
		mode,
		you,
		youIncluded: d.youIncluded,
		others: d.others,
		paidBy: d.paidBy,
		fullAmount: d.split === "full",
		amount: d.minor ? major(d.minor, d.currency) : 0,
		exact,
		percentages: d.pct,
		shares: d.shares,
	};
}

/** Minor units the custom rows still need (negative: over). */
export function amountLeft(d: ExpenseDraft, you: SplitRef): number {
	const members = splitMembers({
		you,
		youIncluded: d.youIncluded,
		others: d.others,
	});
	const sum = members.reduce((t, p) => t + (d.exact[splitKey(p)] ?? 0), 0);
	return (d.minor ?? 0) - sum;
}

export function pctLeft(d: ExpenseDraft, you: SplitRef): number {
	const members = splitMembers({
		you,
		youIncluded: d.youIncluded,
		others: d.others,
	});
	return 100 - members.reduce((t, p) => t + (d.pct[splitKey(p)] ?? 0), 0);
}

export function validate(
	d: ExpenseDraft,
	o: { home: string; you: SplitRef; rateMissing: boolean },
): DraftErrors {
	const e: DraftErrors = {};
	if (!d.minor || d.minor <= 0) e.amount = true;
	if (!d.categoryId) e.category = true;
	if (isForeign(d, o.home) && (d.custom ? !d.customRate : o.rateMissing))
		e.rate = true;
	if (isShared(d) && d.split === "custom") {
		if (d.by === "amount" && amountLeft(d, o.you) !== 0) e.split = true;
		if (d.by === "pct" && Math.abs(pctLeft(d, o.you)) >= 0.01) e.split = true;
	}
	return e;
}

const spreadMonths = (d: ExpenseDraft) =>
	d.spread === "one" ? undefined : Number(d.spread);

function rateFields(d: ExpenseDraft, home: string) {
	if (!isForeign(d, home)) return {};
	if (d.custom && d.customRate) return { customRate: d.customRate };
	return d.rateType ? { rateType: d.rateType } : {};
}

/** entry.expense.create / update input, or null while it cannot be saved. */
export function personalInput(
	d: ExpenseDraft,
	o: { home: string; categoryName: string },
) {
	if (!d.minor || !d.categoryId) return null;
	return {
		id: d.editing?.id ?? d.newId,
		title: d.title.trim() || o.categoryName,
		amount: fromMinor({ minor: d.minor, currency: d.currency }),
		currency: d.currency,
		date: d.date,
		categoryId: d.categoryId,
		...rateFields(d, o.home),
		...(d.note.trim() ? { description: d.note.trim() } : {}),
		...(d.location.trim() ? { location: d.location.trim() } : {}),
		...(spreadMonths(d) ? { amortizeOver: spreadMonths(d) } : {}),
		excludeFromAnalytics: d.exclude,
	};
}

/** entry.shared.create input (and update with the id), or null while it cannot be saved. */
export function sharedInput(
	d: ExpenseDraft,
	o: { you: SplitRef; categoryName: string },
) {
	if (!d.minor || !d.categoryId) return null;
	const split = buildSplitInput(splitStateOf(d, o.you));
	if (split.splitWith.length === 0) return null;
	return {
		amount: fromMinor({ minor: d.minor, currency: d.currency }),
		currency: d.currency,
		description: d.title.trim() || o.categoryName,
		categoryId: d.categoryId,
		date: d.date,
		...(d.note.trim() ? { notes: d.note.trim() } : {}),
		paidBy: d.paidBy,
		...split,
	};
}
