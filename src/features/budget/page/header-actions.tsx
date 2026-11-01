"use client";

import { ArrowDownLeft, FlaskConical } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { useEntrySheets } from "~/features/entry/context";
import { Tip } from "~/components/ui/tooltip";
import type { BudgetActions } from "./use-budget-actions";

/** What the header can show as buttons; the rest stays in the ⋯ menu. */
export type HeaderPromoted = {
	income: boolean;
	plan: boolean;
	whatIf: boolean;
};

/**
 * Which actions the header shows as buttons. A month you can still act on
 * gets Add income, Plan next month (from this month only) and What if I
 * spend; a closed month, the plan itself and a phone (two trailing buttons at
 * most) keep everything in the menu, except that a phone shows Add income as
 * an icon. Add income is the Add family's own sheet (the global Add menu's
 * Income), so it is always there; the menu's "Money in" is the read-only
 * view of what came in.
 */
export function promotedActions({
	actions,
	readOnly,
	planning,
	isCurrent,
	phone,
}: {
	actions: BudgetActions;
	readOnly: boolean;
	planning: boolean;
	isCurrent: boolean;
	phone: boolean;
}): HeaderPromoted {
	const live = !readOnly && !planning;
	return {
		income: live,
		plan: live && isCurrent && !phone,
		whatIf: live && actions.can("whatIf") && !phone,
	};
}

/**
 * The most used Budget actions, at the top (GUIDELINE §3): one primary (Add
 * income), Plan next month as secondary and What if I spend as an icon.
 * Phones get Add income as an icon beside the menu.
 */
export function HeaderActions({
	actions,
	promoted,
	phone,
	onPlan,
}: {
	actions: BudgetActions;
	promoted: HeaderPromoted;
	phone: boolean;
	onPlan: () => void;
}) {
	const t = useTranslations("entityActions.budgetMenu");
	const add = useTranslations("shell.add");
	const entry = useEntrySheets();
	const addIncome = () => entry.open({ kind: "income" });
	return (
		<>
			{promoted.whatIf && (
				<Tip content={t("whatIf.label")}>
					<Button
						aria-label={t("whatIf.label")}
						icon
						kind="ghost"
						onClick={() => actions.openMonth("whatIf")}
					>
						<FlaskConical />
					</Button>
				</Tip>
			)}
			{promoted.plan && (
				<Button kind="secondary" onClick={onPlan}>
					{t("planNext.label")}
				</Button>
			)}
			{promoted.income &&
				(phone ? (
					<Tip content={add("income")}>
						<Button
							aria-label={add("income")}
							icon
							kind="ghost"
							onClick={addIncome}
						>
							<ArrowDownLeft />
						</Button>
					</Tip>
				) : (
					<Button kind="primary" onClick={addIncome}>
						{add("income")}
					</Button>
				))}
		</>
	);
}
