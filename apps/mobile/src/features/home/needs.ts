import type { RetrospendClient } from "@retrospend/api-client";
import { type PersonRef, refOfKey } from "@/features/people/source";
import type { GlyphName } from "@/ui/Glyph";

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
	"budget.overAssigned",
	"budget.overspent",
	"budget.billDue",
	"budget.sharesNeedEnvelope",
	"budget.startingMoney",
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

/** Where an item's job is done: a person, or a screen. */
export type NeedsDestination =
	| { kind: "person"; ref: PersonRef }
	| {
			kind:
				| "people"
				| "recurring"
				| "activity"
				| "budget"
				| "currencies"
				| "settings"
				| "import"
				| "add";
	  };

/**
 * Every item opens its job. The ones about a person open that person; the
 * rest open the screen that holds the action (a plan and its envelopes live
 * in Budget, a due bill in Recurring, a missing rate in Currencies).
 */
export function needsDestination(item: NeedsYouItem): NeedsDestination {
	switch (item.type) {
		case "payment.confirm":
		case "split.review":
		case "split.rejected":
		case "split.fixRequested":
		case "people.owedAging": {
			const ref = needsTarget(item);
			return ref ? { kind: "person", ref } : { kind: "people" };
		}
		case "recurring.overdue":
		case "recurring.due":
			return { kind: "recurring" };
		case "import.review":
			return { kind: "activity" };
		case "budget.missingRate":
			return { kind: "currencies" };
		case "setup.firstExpense":
			return { kind: "add" };
		case "setup.homeCurrency":
		case "setup.verifyEmail":
			return { kind: "settings" };
		case "setup.importStatement":
			return { kind: "import" };
		default:
			return { kind: "budget" };
	}
}

/** The one action's word, a key under `mobile.home.needs.action`. */
export type NeedsAction =
	| "confirm"
	| "review"
	| "open"
	| "respond"
	| "assign"
	| "cover"
	| "takeBack"
	| "fund"
	| "setRate"
	| "addExpense"
	| "choose"
	| "import";

export function needsAction(item: NeedsYouItem): NeedsAction {
	switch (item.type) {
		case "payment.confirm":
		case "recurring.overdue":
		case "recurring.due":
			return "confirm";
		case "split.review":
		case "import.review":
		case "budget.hiddenReview":
			return "review";
		case "split.fixRequested":
			return "respond";
		case "budget.giveJob":
			return "assign";
		case "budget.overspent":
			return "cover";
		case "budget.overAssigned":
			return "takeBack";
		case "budget.billDue":
			return "fund";
		case "budget.missingRate":
			return "setRate";
		case "setup.firstExpense":
			return "addExpense";
		case "setup.homeCurrency":
			return "choose";
		case "setup.importStatement":
			return "import";
		default:
			return "open";
	}
}

/** The glyph on the tile of an item that is not about a person. */
export function needsGlyph(item: NeedsYouItem): GlyphName {
	switch (item.type) {
		case "recurring.overdue":
			return "AlarmClock";
		case "recurring.due":
			return "Repeat";
		case "import.review":
		case "budget.hiddenReview":
			return "ListChecks";
		case "budget.giveJob":
		case "budget.sharesNeedEnvelope":
			return "Wallet";
		case "budget.overspent":
			return "CircleAlert";
		case "budget.overAssigned":
			return "Scale";
		case "budget.billDue":
		case "budget.debtDue":
			return "CalendarClock";
		case "budget.startingMoney":
			return "Landmark";
		case "budget.missingRate":
		case "setup.homeCurrency":
			return "Coins";
		case "setup.firstExpense":
			return "Plus";
		case "setup.verifyEmail":
			return "Mail";
		case "setup.importStatement":
			return "FileUp";
		case "payment.confirm":
			return "CircleCheck";
		case "split.review":
			return "UserCheck";
		case "split.rejected":
			return "UserX";
		case "split.fixRequested":
			return "MessageCircle";
		default:
			return "CircleAlert";
	}
}

/** The one fact under a sentence, from the item's own date: its word and its day. */
export function needsContext(
	item: NeedsYouItem,
): { key: "wasDue" | "dueOn"; day: string } | null {
	if (!item.date) return null;
	if (item.type === "recurring.overdue") {
		return { key: "wasDue", day: item.date };
	}
	if (item.type === "recurring.due") return { key: "dueOn", day: item.date };
	return null;
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
