import {
	ArrowDownLeft,
	CalendarCheck,
	CircleHelp,
	CreditCard,
	FlaskConical,
	Layers,
	ListChecks,
	NotebookPen,
	Percent,
	Plus,
	SlidersHorizontal,
	TrendingDown,
} from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

/**
 * The Budget page's own ⋯ (budget.html header overflow): what the page can
 * start that is not the one thing it asks for now. Distinct from `budget`,
 * which lists the prompts of Needs you. Each item opens a sheet, except
 * Plan next month, which opens the month after this one.
 */
export type BudgetMenuTarget = ActionTarget;

export const BUDGET_MENU_ACTIONS: readonly ActionDef<BudgetMenuTarget>[] = [
	{ id: "addIncome", icon: ArrowDownLeft, group: 0 },
	{ id: "usePlan", icon: ListChecks, group: 0 },
	{ id: "planNext", icon: NotebookPen, group: 0 },
	{ id: "payoffPlan", icon: TrendingDown, group: 1 },
	{ id: "payDebt", icon: CreditCard, group: 1 },
	{ id: "summary", icon: CalendarCheck, group: 2 },
	{ id: "whatIf", icon: FlaskConical, group: 2 },
	{ id: "addEnvelope", icon: Plus, group: 3 },
	{ id: "combine", icon: Layers, group: 3 },
	{ id: "rules", icon: Percent, group: 3 },
	{ id: "style", icon: SlidersHorizontal, group: 3 },
	{ id: "help", icon: CircleHelp, group: 3 },
];
