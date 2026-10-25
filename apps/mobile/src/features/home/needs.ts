import type { RetrospendClient } from "@retrospend/api-client";
import { type PersonRef, refOfKey } from "@/features/people/source";

export type NeedsYouList = Awaited<
	ReturnType<RetrospendClient["needs-you"]["list"]>
>;
export type NeedsYouItem = NeedsYouList["items"][number];

/** Types the home screen words itself; the rest read as a plain "needs you". */
const WORDED = new Set<string>([
	"payment.confirm",
	"split.review",
	"split.rejected",
	"split.fixRequested",
	"recurring.overdue",
	"recurring.due",
	"import.review",
	"people.owedAging",
	"budget.giveJob",
	"budget.overspent",
	"budget.missingRate",
	"setup.firstExpense",
	"setup.homeCurrency",
	"setup.verifyEmail",
	"setup.importStatement",
]);

/** Types whose primary action is the person they are about. */
const PERSON_TYPES = new Set<string>([
	"payment.confirm",
	"split.review",
	"split.rejected",
	"split.fixRequested",
	"people.owedAging",
]);

export interface NeedsLine {
	/** The key under `mobile.home.needs` (dots in the type become underscores). */
	message: string;
	/** First name of the person it is about. */
	name: string;
	/** A title the person typed, as is. */
	title: string;
	count: number;
	currencies: string;
}

/**
 * The server sends facts; the phone words them. Never a title or a number
 * made up here: the values are the item's own.
 */
export function needsLine(item: NeedsYouItem, list: NeedsYouList): NeedsLine {
	const first = item.people[0];
	const name = (first ? list.people[first]?.name : undefined) ?? "";
	return {
		message: WORDED.has(item.type) ? item.type.replace(".", "_") : "generic",
		name: name.split(/\s+/)[0] ?? "",
		title: item.title ?? "",
		count: item.count ?? item.entityIds.length,
		currencies: item.currencies.join(", "),
	};
}

/** The person screen an item opens, for the items that are about a person. */
export function needsTarget(item: NeedsYouItem): PersonRef | null {
	const key = item.people[0];
	if (!key || !PERSON_TYPES.has(item.type)) return null;
	return refOfKey(key);
}

/** Items put off with "Later" come back the next day. */
export interface Snoozed {
	day: string;
	ids: string[];
}

export function visibleNeeds(
	items: NeedsYouItem[],
	snoozed: Snoozed | null,
	today: string,
): { shown: NeedsYouItem[]; hidden: number } {
	const ids = new Set(snoozed && snoozed.day === today ? snoozed.ids : []);
	const shown = items.filter((item) => !ids.has(item.id));
	return { shown, hidden: items.length - shown.length };
}
