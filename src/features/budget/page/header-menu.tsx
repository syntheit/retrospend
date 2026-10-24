"use client";

import type { LucideIcon } from "lucide-react";
import {
	ArrowDownLeft,
	CalendarCheck,
	CircleHelp,
	EllipsisIcon,
	FlaskConical,
	Layers,
	ListChecks,
	NotebookPen,
	Plus,
	SlidersHorizontal,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment } from "react";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Tip } from "~/components/ui/tooltip";
import type { BudgetActions } from "./use-budget-actions";

type Item = { id: string; icon: LucideIcon; run: () => void };

/**
 * The header's overflow (R1): everything the page can start that is not the
 * one thing it asks for now. Each item opens its sheet; Plan next month
 * opens the month after this one.
 */
export function HeaderMenu({
	actions,
	month,
	onPlan,
	readOnly,
}: {
	actions: BudgetActions;
	month: number;
	onPlan: () => void;
	readOnly: boolean;
}) {
	const t = useTranslations("budgetPage.menu");
	const open = actions.sheet.open;
	const money: Item[] = [
		{
			id: "addIncome",
			icon: ArrowDownLeft,
			run: () => open("addIncome", { month }),
		},
		{ id: "usePlan", icon: ListChecks, run: () => open("usePlan", { month }) },
		{ id: "planNext", icon: NotebookPen, run: onPlan },
	];
	const view: Item[] = [
		{
			id: "summary",
			icon: CalendarCheck,
			run: () => open("monthSummary", { month }),
		},
		{ id: "whatIf", icon: FlaskConical, run: () => open("whatIf", { month }) },
	];
	const manage: Item[] = [
		{
			id: "addEnvelope",
			icon: Plus,
			run: () => open("newEnvelope", { month }),
		},
		{
			id: "combine",
			icon: Layers,
			run: () => open("mergeEnvelopes", { month }),
		},
		{ id: "rules", icon: ListChecks, run: () => open("rules", { month }) },
		{
			id: "style",
			icon: SlidersHorizontal,
			run: () => open("style", { month }),
		},
		{ id: "help", icon: CircleHelp, run: () => open("help", { month }) },
	];
	const groups = (
		readOnly ? [view, manage.slice(-1)] : [money, view, manage]
	).filter((g) => g.length > 0);
	return (
		<DropdownMenu>
			<Tip content={t("more")}>
				<DropdownMenuTrigger asChild>
					<Button aria-label={t("more")} icon kind="ghost">
						<EllipsisIcon />
					</Button>
				</DropdownMenuTrigger>
			</Tip>
			<DropdownMenuContent align="end">
				{groups.map((g, i) => (
					<Fragment key={g[0]?.id}>
						{i > 0 && <DropdownMenuSeparator />}
						{g.map((item) => (
							<DropdownMenuItem key={item.id} onSelect={item.run}>
								<item.icon aria-hidden="true" />
								{t(item.id)}
							</DropdownMenuItem>
						))}
					</Fragment>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
