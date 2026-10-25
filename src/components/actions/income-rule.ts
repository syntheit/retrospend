import { ArrowDown, ArrowUp, ListChecks, Trash2 } from "lucide-react";
import type { ActionDef, ActionTarget } from "./types";

/**
 * An income rule in the Rules sheet (SPEC §5.10, §6.10): move it in the order
 * the rules run, apply it once to this month's money in (its own previewed
 * sheet), or remove it. Pausing is the row's switch, not a menu action.
 */
export type IncomeRuleTarget = ActionTarget & {
	first: boolean;
	last: boolean;
	active: boolean;
};

export const INCOME_RULE_ACTIONS: readonly ActionDef<IncomeRuleTarget>[] = [
	{ id: "moveUp", icon: ArrowUp, group: 0, when: (r) => !r.first },
	{ id: "moveDown", icon: ArrowDown, group: 0, when: (r) => !r.last },
	{ id: "applyToMonth", icon: ListChecks, group: 1, when: (r) => r.active },
	// Past batches stay as they are, so this asks first with a named button.
	{ id: "remove", icon: Trash2, group: 2, danger: true },
];
