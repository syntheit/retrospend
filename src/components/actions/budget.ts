import {
	ArrowLeftRight,
	Banknote,
	ClipboardCheck,
	Coins,
	FileText,
	GitCompareArrows,
	HandCoins,
	Inbox,
	Landmark,
	ListChecks,
	Mail,
	Undo2,
	Wallet,
} from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

/**
 * A budget prompt from Needs you (an envelope, the month's money), with the
 * action ids the needs-you catalog lists (src/server/services/needs-you/
 * catalog.ts). The last six belong to types whose source is not built yet
 * (debt due, share routing, month close, hidden rows, reconcile); a page
 * offers an action only once it passes its handler.
 */
export type BudgetTarget = ActionTarget;

export const BUDGET_ACTIONS: readonly ActionDef<BudgetTarget>[] = [
	{ id: "fund", icon: HandCoins, group: 0 },
	{ id: "cover", icon: ArrowLeftRight, group: 0 },
	{ id: "takeBack", icon: Undo2, group: 0 },
	{ id: "usePlan", icon: ListChecks, group: 0 },
	{ id: "assign", icon: Wallet, group: 0 },
	{ id: "setRate", icon: Coins, group: 0 },
	{ id: "confirmStartingMoney", icon: Landmark, group: 0 },
	{ id: "recordPayment", icon: Banknote, group: 0 },
	{ id: "pickEnvelope", icon: Mail, group: 0 },
	{ id: "openSummary", icon: FileText, group: 0 },
	{ id: "seeChanges", icon: GitCompareArrows, group: 0 },
	{ id: "reviewHidden", icon: Inbox, group: 0 },
	{ id: "reconcile", icon: ClipboardCheck, group: 0 },
];
