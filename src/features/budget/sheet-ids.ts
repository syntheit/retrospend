/**
 * The Budget sheets by id, named after the mockup's openers (budget-kit.js
 * BX.*Sheet). The page opens a sheet with `useBudgetSheets().open(id, params)`
 * and the host in sheets/host.tsx renders the one registered under the id.
 */
export const BUDGET_SHEET_IDS = [
	"assign",
	"cover",
	"coverAll",
	"move",
	"target",
	"wealth",
	"close",
	"owed",
	"settle",
	"forgive",
	"plan",
	"takeBack",
	"migrate",
	"whatMoved",
	"fundNow",
	"income",
	"fromWealth",
	"rules",
	"help",
	"envelope",
	"merge",
	"afford",
	"style",
	"debt",
	"payDebt",
	"raiseLimit",
	"setLimit",
	"whatIf",
	"setup",
	"welcomeBack",
	"reconcile",
	"explain",
] as const;

export type BudgetSheetId = (typeof BUDGET_SHEET_IDS)[number];
