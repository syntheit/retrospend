"use client";

import { useTranslations } from "next-intl";
import { ActionMenu } from "~/components/actions/action-menu";
import type { BudgetActions, MonthSheet } from "./use-budget-actions";

/** Which sheet each menu item opens; Plan next month opens the next month instead. */
const SHEET: Record<string, MonthSheet | null> = {
	addIncome: "income",
	usePlan: "usePlan",
	planNext: null,
	payoffPlan: "debt",
	payDebt: "payDebt",
	summary: "monthSummary",
	whatIf: "whatIf",
	addEnvelope: "newEnvelope",
	combine: "mergeEnvelopes",
	rules: "rules",
	style: "style",
	help: "help",
};

/** A closed month offers only what reads: its summary and the words. */
const READ_ONLY = new Set(["summary", "help"]);
const DEBT = new Set(["payoffPlan", "payDebt"]);

/**
 * The header's overflow (R1), from the action registry (budgetMenu): every
 * item the page can start that is not the one thing it asks for now. An item
 * whose sheet does not exist yet is not offered (no dead buttons).
 */
export function HeaderMenu({
	actions,
	onPlan,
	readOnly,
	hasDebt,
}: {
	actions: BudgetActions;
	onPlan: () => void;
	readOnly: boolean;
	/** The book has a debt (a bill that follows a liability) or is Pay off debt. */
	hasDebt: boolean;
}) {
	const t = useTranslations("budgetPage");
	const handlers: Record<string, () => void> = {};
	for (const [id, sheet] of Object.entries(SHEET)) {
		if (readOnly && !READ_ONLY.has(id)) continue;
		if (DEBT.has(id) && !hasDebt) continue;
		if (sheet === null) handlers[id] = onPlan;
		else if (actions.can(sheet)) handlers[id] = () => actions.openMonth(sheet);
	}
	return (
		<ActionMenu
			entity="budgetMenu"
			handlers={handlers}
			target={{ id: "budget", name: t("title") }}
		/>
	);
}
