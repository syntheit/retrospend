"use client";

import { useTranslations } from "next-intl";
import { Fragment } from "react";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import type { RecurringTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import { TABLE_LOOK } from "~/components/table/table-style";
import { Button } from "~/components/ui/button";
import { CategoryTile } from "~/components/ui/category-badge";
import { StatusDot } from "~/components/ui/status-dot";
import { Switch } from "~/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import { cn } from "~/lib/cn";
import type { RecurringItemDTO } from "~/server/services/recurring-view.service";
import { daysUntil, isDue, type RecurringGroup } from "./groups";
import { amountFigure, categoryOf } from "./item-vm";
import { targetOf } from "./use-recurring";

type Props = {
	groups: RecurringGroup[];
	today: string;
	handlersFor: (r: RecurringItemDTO) => ActionHandlers<RecurringTarget>;
	onConfirm: (r: RecurringItemDTO) => void;
	onAutoPay: (r: RecurringItemDTO, on: boolean) => void;
	onOpen: (r: RecurringItemDTO) => void;
};

function Due({ r, today }: { r: RecurringItemDTO; today: string }) {
	const t = useTranslations("activityRecurring.due");
	const { short } = useRowDates(today);
	if (r.paused) return <span className="text-fg-2">{t("paused")}</span>;
	if (r.state === "overdue")
		return (
			<StatusDot
				kind="overdue"
				label={t("overdueSince", { date: short(r.next) })}
				size="sm"
			/>
		);
	if (r.state === "due")
		return <StatusDot kind="due" label={t("today")} size="sm" />;
	return (
		<span>
			{short(r.next)}{" "}
			<span className="text-fg-3 text-meta">
				{t("inDays", { count: daysUntil(r, today) })}
			</span>
		</span>
	);
}

/** Money in reads positive with a plus; a foreign amount pairs with its home value. */
export function RecurringMoney({ r }: { r: RecurringItemDTO }) {
	const tone = r.direction === "in" ? "text-positive" : undefined;
	const sign = r.direction === "in" ? "exceptZero" : "auto";
	if (r.home !== undefined)
		return (
			<Money.pair
				className={tone}
				figure={amountFigure(r)}
				home={r.home}
				original={r.amount}
				sign={sign}
			/>
		);
	return (
		<Money
			className={tone}
			figure={amountFigure(r)}
			sign={sign}
			value={r.amount}
		/>
	);
}

function Row({ r, p }: { r: RecurringItemDTO; p: Props }) {
	const t = useTranslations("activityRecurring");
	const target = targetOf(r);
	const handlers = p.handlersFor(r);
	return (
		<ActionArea entity="recurring" handlers={handlers} target={target}>
			<TableRow
				className={cn("cursor-pointer", r.paused && "text-fg-3")}
				data-id={r.id}
				onClick={(e) => {
					if ((e.target as HTMLElement).closest("button,a,[role=switch]"))
						return;
					p.onOpen(r);
				}}
				tabIndex={0}
			>
				<TableCell>
					<span className="flex min-w-0 items-center gap-2">
						<CategoryTile category={categoryOf(r, t("other"))} size="sm" />
						<span className="text-fg truncate">{r.title}</span>
						<span className="text-fg-3 text-meta truncate">
							{r.category.name ?? t("other")}
						</span>
					</span>
				</TableCell>
				<TableCell>
					<Due r={r} today={p.today} />
				</TableCell>
				<TableCell className="text-fg-2">
					{t(`frequency.${r.frequency}`)}
				</TableCell>
				<TableCell className="text-right">
					<RecurringMoney r={r} />
				</TableCell>
				<TableCell className="text-center">
					<Switch
						aria-label={t("table.autoPayFor", { name: r.title })}
						checked={r.autoPay}
						onCheckedChange={(on) => p.onAutoPay(r, on)}
					/>
				</TableCell>
				<TableCell className="text-right whitespace-nowrap">
					<span className="inline-flex items-center gap-1">
						{isDue(r) && (
							<Button kind="secondary" onClick={() => p.onConfirm(r)} size="sm">
								{t("confirm")}
							</Button>
						)}
						<ActionMenu
							entity="recurring"
							handlers={handlers}
							target={target}
						/>
					</span>
				</TableCell>
			</TableRow>
		</ActionArea>
	);
}

/**
 * Desktop: one table, grouped by due date (Due now, Next 30 days, Later,
 * Money in). Confirm sits on the due rows; the rest is in the registry menu.
 */
export function RecurringTable(p: Props) {
	const t = useTranslations("activityRecurring");
	return (
		<div className={TABLE_LOOK}>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>{t("table.name")}</TableHead>
						<TableHead className="w-44">{t("table.due")}</TableHead>
						<TableHead className="w-28">{t("table.repeats")}</TableHead>
						<TableHead className="w-44 text-right">
							{t("table.amount")}
						</TableHead>
						<TableHead className="w-20 text-center">
							{t("table.autoPay")}
						</TableHead>
						<TableHead className="w-36">
							<span className="sr-only">{t("table.actions")}</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{p.groups.map((g) => (
						<Fragment key={g.id}>
							<TableRow
								className="can-hover:hover:bg-transparent"
								data-group={g.id}
							>
								<TableCell
									className="bg-bg text-fg-2 text-small font-medium"
									colSpan={6}
								>
									{t(`group.${g.id}`)}
									<span className="text-fg-3 ml-2 tabular-nums">
										{g.items.length}
									</span>
								</TableCell>
							</TableRow>
							{g.items.map((r) => (
								<Row key={r.id} p={p} r={r} />
							))}
						</Fragment>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
