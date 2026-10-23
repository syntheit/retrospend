/**
 * One row per Needs you type: its group, its place in the order and the
 * actions it supports. Types whose source is not built yet are in SEAMS
 * with what they wait for, so the list never invents an item (no fake data).
 *
 * Order (SYNTHESIS-r5 RC-11, the kit ledger's RANK): overdue bills first,
 * then payments to confirm, splits to review, imports, due today, then the
 * budget prompts. Budget SPEC §5.14 types slot in by urgency: a debt due
 * today sits with overdue bills, a bill due this week before the softer
 * budget prompts, Give it a job after anything over. Setup prompts last.
 */
import type {
	NeedsYouAction,
	NeedsYouGroup,
	NeedsYouItem,
	NeedsYouType,
} from "./types";

interface TypeSpec {
	readonly group: NeedsYouGroup;
	readonly rank: number;
	/** The primary action first. */
	readonly actions: readonly NeedsYouAction[];
}

const act = (entity: string, ...ids: string[]): NeedsYouAction[] =>
	ids.map((id) => ({ entity, id }));

export const CATALOG: Readonly<Record<NeedsYouType, TypeSpec>> = {
	"recurring.overdue": {
		group: "activity",
		rank: 0,
		actions: act("recurring", "confirm", "editAmount", "skip"),
	},
	"budget.debtDue": {
		group: "budget",
		rank: 0,
		actions: act("budget", "recordPayment"),
	},
	"payment.confirm": {
		group: "people",
		rank: 1,
		actions: act("payment", "confirm", "notReceived"),
	},
	"split.review": {
		group: "people",
		rank: 2,
		actions: act("expense", "review"),
	},
	"split.rejected": {
		group: "people",
		rank: 3,
		actions: act("expense", "edit"),
	},
	"split.fixRequested": {
		group: "people",
		rank: 3,
		actions: act("expense", "edit", "correct"),
	},
	"import.review": {
		group: "activity",
		rank: 4,
		actions: act("import", "review"),
	},
	"recurring.due": {
		group: "activity",
		rank: 5,
		actions: act("recurring", "confirm", "editAmount", "skip"),
	},
	"budget.billDue": {
		group: "budget",
		rank: 6,
		actions: act("budget", "fund"),
	},
	"budget.overspent": {
		group: "budget",
		rank: 7,
		actions: act("budget", "cover"),
	},
	"budget.overAssigned": {
		group: "budget",
		rank: 8,
		actions: act("budget", "takeBack"),
	},
	"budget.giveJob": {
		group: "budget",
		rank: 9,
		actions: act("budget", "usePlan", "assign"),
	},
	"budget.missingRate": {
		group: "budget",
		rank: 10,
		actions: act("budget", "setRate"),
	},
	"budget.sharesNeedEnvelope": {
		group: "budget",
		rank: 11,
		actions: act("budget", "pickEnvelope"),
	},
	"budget.startingMoney": {
		group: "budget",
		rank: 12,
		actions: act("budget", "confirmStartingMoney"),
	},
	"budget.monthSummary": {
		group: "budget",
		rank: 13,
		actions: act("budget", "openSummary"),
	},
	"budget.monthChanged": {
		group: "budget",
		rank: 13,
		actions: act("budget", "seeChanges"),
	},
	"budget.hiddenReview": {
		group: "budget",
		rank: 14,
		actions: act("budget", "reviewHidden"),
	},
	"budget.reconcile": {
		group: "budget",
		rank: 15,
		actions: act("budget", "reconcile"),
	},
	"people.owedAging": {
		group: "people",
		rank: 16,
		// Forgive joins with 2C.2.
		actions: act("person", "remind"),
	},
	"setup.firstExpense": {
		group: "setup",
		rank: 20,
		actions: act("setup", "addExpense"),
	},
	"setup.homeCurrency": {
		group: "setup",
		rank: 21,
		actions: act("setup", "chooseCurrency"),
	},
	"setup.verifyEmail": {
		group: "setup",
		rank: 22,
		actions: act("setup", "resendEmail"),
	},
	"setup.importStatement": {
		group: "setup",
		rank: 23,
		actions: act("setup", "import"),
	},
};

/** Types no source produces yet, and what each waits for (report and GAPS). */
export const SEAMS: Readonly<Partial<Record<NeedsYouType, string>>> = {
	"split.fixRequested": "2C.2 Ask to fix: the ask state is not stored yet",
	"budget.debtDue": "P5 payoff: liability minimums and due days",
	"budget.sharesNeedEnvelope":
		"D19 share routing: splits-replay does not flag unresolved shares yet",
	"budget.monthSummary": "P4 month close and its summary",
	"budget.monthChanged": "P4 recalculation after close",
	"budget.hiddenReview": "P7 migration of hidden legacy rows",
	"budget.reconcile": "P4 reconcile (monthly, after a first reconcile)",
	"people.owedAging":
		"per-person age of the oldest open balance (SPEC §5.8) is not read anywhere yet",
};

/** Urgency, then the oldest date first (undated last), then id: the same input reads the same way. */
export function compareItems(a: NeedsYouItem, b: NeedsYouItem): number {
	const rank = CATALOG[a.type].rank - CATALOG[b.type].rank;
	if (rank !== 0) return rank;
	if (a.date !== b.date) {
		if (a.date === null) return 1;
		if (b.date === null) return -1;
		return a.date < b.date ? -1 : 1;
	}
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Items per group and in total. */
export function countByGroup(
	items: readonly NeedsYouItem[],
): Record<NeedsYouGroup | "total", number> {
	const counts = { people: 0, activity: 0, budget: 0, setup: 0, total: 0 };
	for (const item of items) {
		counts[item.group] += 1;
		counts.total += 1;
	}
	return counts;
}

type ItemFacts = Partial<
	Omit<NeedsYouItem, "type" | "group" | "actions" | "id">
> & { readonly key?: string };

/** Builds an item with its catalog group and actions; `key` makes the id unique per entity. */
export function item(type: NeedsYouType, facts: ItemFacts): NeedsYouItem {
	const spec = CATALOG[type];
	const { key, ...rest } = facts;
	return {
		id: key ? `${type}:${key}` : type,
		type,
		group: spec.group,
		entity: null,
		entityIds: [],
		people: [],
		amount: null,
		count: null,
		date: null,
		title: null,
		attention: false,
		direction: null,
		askAmount: false,
		currencies: [],
		...rest,
		actions: spec.actions,
	};
}
