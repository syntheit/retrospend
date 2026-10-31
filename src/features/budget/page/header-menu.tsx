"use client";

import { useTranslations } from "next-intl";
import { ActionMenu } from "~/components/actions/action-menu";
import type { HeaderPromoted } from "./header-actions";
import type { BudgetActions, MonthSheet } from "./use-budget-actions";

/** Which sheet each menu item opens; Plan next month opens the next month instead. */
const SHEET: Record<string, MonthSheet | null> = {
	addIncome: "income",
	usePlan: "usePlan",
	planNext: null,
	payoffPlan: "debt",
	payDebt: "payDebt",
	summary: "monthSummary",
	reconcile: "reconcile",
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

/** The menu items the header already shows as buttons. */
const PROMOTED_ID: Partial<Record<keyof HeaderPromoted, string>> = {
	plan: "planNext",
	whatIf: "whatIf",
};

/**
 * The header's overflow (R1), from the action registry (budgetMenu): every
 * item the page can start that the header does not already show as a button.
 * An item whose sheet does not exist yet is not offered (no dead buttons).
 */
export function HeaderMenu({
	actions,
	onPlan,
	readOnly,
	hasDebt,
	promoted,
}: {
	actions: BudgetActions;
	onPlan: () => void;
	readOnly: boolean;
	/** The book has a debt (a bill that follows a liability) or is Pay off debt. */
	hasDebt: boolean;
	promoted: HeaderPromoted;
}) {
	const t = useTranslations("budgetPage");
	const handlers: Record<string, () => void> = {};
	const shown = new Set(
		(Object.keys(PROMOTED_ID) as (keyof HeaderPromoted)[])
			.filter((k) => promoted[k])
			.map((k) => PROMOTED_ID[k] as string),
	);
	for (const [id, sheet] of Object.entries(SHEET)) {
		if (shown.has(id)) continue;
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
