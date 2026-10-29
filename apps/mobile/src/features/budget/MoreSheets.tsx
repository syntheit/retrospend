import type { MonthKind } from "./months";

/**
 * The sheets of the plan and tidy list beyond the first eight: each is one
 * row there and one sheet in the registry (sheetRegistry.tsx). The Budget tab
 * opens one at a time.
 */
export type MoreKind =
	| "income"
	| "rules"
	| "owed"
	| "unrouted"
	| "whatIf"
	| "plan"
	| "planApply"
	| "fundNow"
	| "close"
	| "welcomeBack"
	| "startingMoney"
	| "toWealth"
	| "fromWealth";

export const MORE_KINDS: readonly MoreKind[] = [
	"income",
	"rules",
	"owed",
	"unrouted",
	"whatIf",
	"plan",
	"planApply",
	"fundNow",
	"close",
	"welcomeBack",
	"startingMoney",
	"toWealth",
	"fromWealth",
];

/** The rows the list adds, in order, and the kinds of month they show in. */
export const MORE_ROWS: readonly {
	kind: MoreKind;
	months: readonly MonthKind[];
}[] = [
	{ kind: "income", months: ["open"] },
	{ kind: "rules", months: ["open", "next"] },
	{ kind: "owed", months: ["open"] },
	{ kind: "unrouted", months: ["open"] },
	{ kind: "whatIf", months: ["open"] },
	{ kind: "plan", months: ["next"] },
	{ kind: "planApply", months: ["next"] },
	{ kind: "fundNow", months: ["open", "next"] },
	{ kind: "close", months: ["closed"] },
	{ kind: "welcomeBack", months: ["open"] },
	{ kind: "startingMoney", months: ["open"] },
	{ kind: "toWealth", months: ["open"] },
	{ kind: "fromWealth", months: ["open"] },
];
