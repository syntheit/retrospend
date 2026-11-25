/**
 * Everything that holds a category id, and what a merge or delete does with
 * each. This list is the one owner of "who holds a category": the server's
 * move and its undo are both keyed by `HolderId`, and a server test builds
 * the list again from the schema (every foreign key to Category, every Json
 * column) and fails when a holder has no rule here (AGENTS 6.8).
 *
 * Rules:
 * - move: the rows take the target's id (null when the category is only
 *   deleted); the undo puts them back by the stamp the move left.
 * - dedupe: a row the target already has (same book, same user) makes the
 *   source's row go; the undo recreates it.
 * - clash: a budget for a period the target already budgets is dropped; one
 *   with no target is deleted; the undo recreates them.
 * - owner: moved through the rule that owns the column (the share category).
 * - guarded: moved only where the caller may edit; otherwise the merge is
 *   refused, so no rule silently stops matching.
 * - left: kept as written, with the reason.
 */

export type HolderRule = "move" | "dedupe" | "clash" | "owner" | "guarded";

export interface Holder {
	readonly id: string;
	readonly model: string;
	readonly field: string;
	readonly rule: HolderRule;
}

/** A relation to Category, found in the schema. */
export const CATEGORY_HOLDERS = [
	{ id: "expense", model: "Expense", field: "categoryId", rule: "move" },
	{
		id: "template",
		model: "RecurringTemplate",
		field: "categoryId",
		rule: "move",
	},
	{
		id: "sharedTransaction",
		model: "SharedTransaction",
		field: "categoryId",
		rule: "move",
	},
	{
		id: "share",
		model: "SplitParticipant",
		field: "categoryId",
		rule: "owner",
	},
	{ id: "budget", model: "Budget", field: "categoryId", rule: "clash" },
	{
		id: "envelopeLink",
		model: "EnvelopeCategory",
		field: "categoryId",
		rule: "dedupe",
	},
	{
		id: "preference",
		model: "AnalyticsCategoryPreference",
		field: "categoryId",
		rule: "dedupe",
	},
] as const satisfies readonly Holder[];

/** Columns that hold a category id inside a Json value or a text value, with no foreign key. */
export const CATEGORY_LOOSE_HOLDERS = [
	{
		id: "incomeRule",
		model: "IncomeRule",
		field: "matchValue",
		rule: "guarded",
	},
	{ id: "draft", model: "BudgetDraft", field: "expectedIn", rule: "move" },
	{ id: "draft", model: "BudgetDraft", field: "pretend", rule: "move" },
] as const satisfies readonly Holder[];

/**
 * Json and text columns that name a category id and are left as written. A
 * pending import's body is sealed user text the server must not open (6.4); a
 * history record describes what was; a closed month's links are refused
 * against (closed-months.ts).
 */
export const CATEGORY_LEFT_ALONE = [
	{
		model: "ImportJob",
		field: "transactions",
		why: "sealed body; the review reads a gone id as uncategorized",
	},
	{
		model: "EnvelopeChange",
		field: "before",
		why: "history of what an envelope edit changed",
	},
	{
		model: "MonthClose",
		field: "summary",
		why: "a closed month keeps its links; a merge that would change its routing is refused",
	},
] as const;

export type HolderId =
	| (typeof CATEGORY_HOLDERS)[number]["id"]
	| (typeof CATEGORY_LOOSE_HOLDERS)[number]["id"];

/** Every holder id once, in the order the move runs. */
export const HOLDER_IDS: readonly HolderId[] = [
	...new Set([...CATEGORY_HOLDERS, ...CATEGORY_LOOSE_HOLDERS].map((h) => h.id)),
];
