"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useRowDates } from "~/components/rows/dates";
import { useIsMobile } from "~/hooks/use-mobile";
import type { EnvelopeGroupDto, GetMonthOutput } from "~/lib/schemas/envelope";
import { api } from "~/trpc/react";
import { BudgetNotice } from "./budget-notice";
import { BudgetRail } from "./budget-rail";
import { ClosedHero } from "./closed-hero";
import { GroupsList } from "./groups-list";
import { GroupsTable } from "./groups-table";
import { BudgetHero } from "./hero";
import { monthStartIso, shiftMonth } from "./months";
import type { BudgetActions } from "./use-budget-actions";
import {
	groupKey,
	groupStartsOpen,
	isLimits,
	namesById,
	pickNotice,
} from "./view-model";

/** Which groups the person folded or opened; each style starts its own way. */
function useFolds(style: GetMonthOutput["book"]["style"]) {
	const [folds, setFolds] = useState<Record<string, boolean>>({});
	const isOpen = (g: EnvelopeGroupDto) =>
		folds[groupKey(g)] ?? groupStartsOpen(style, g);
	const onToggle = (g: EnvelopeGroupDto) =>
		setFolds((f) => ({ ...f, [groupKey(g)]: !isOpen(g) }));
	return { isOpen, onToggle };
}

/**
 * A month that is not the plan: the verdict (or, for a closed month, what it
 * did), the one notice, then the envelopes by group with the rail beside.
 * `groups` are the ones the search and chips left.
 */
export function MonthContent({
	data,
	groups,
	filtering,
	actions,
}: {
	data: GetMonthOutput;
	groups: EnvelopeGroupDto[];
	filtering: boolean;
	actions: BudgetActions;
}) {
	const t = useTranslations("budgetPage");
	const isMobile = useIsMobile();
	const { month: monthName } = useRowDates();
	const folds = useFolds(data.book.style);
	const welcome = api.envelope.welcomeBackState.useQuery(undefined, {
		enabled: !data.book.paused,
		staleTime: 60_000,
	});
	const key = data.month.key;
	const closed = data.month.state === "CLOSED";
	const names = useMemo(() => namesById(data.groups), [data.groups]);
	const notice = closed ? null : pickNotice(data, welcome.data, names);
	const missing = [...new Set(data.missingRates.map((m) => m.currency))];
	const list = { ...folds, groups, actions, readOnly: closed, filtering };
	let columns: "plan" | "limits" | "closed" = "plan";
	if (closed) columns = "closed";
	else if (isLimits(data.book.style)) columns = "limits";
	return (
		<>
			{closed ? (
				<ClosedHero
					month={key}
					onOpenSummary={() =>
						actions.sheet.open("monthSummary", { month: key })
					}
				/>
			) : (
				<BudgetHero
					data={data}
					missing={missing}
					month={monthName(monthStartIso(key))}
					names={names}
					next={monthName(monthStartIso(shiftMonth(key, 1)))}
					onAction={actions.verdict}
					onAfford={() => actions.sheet.open("afford", { month: key })}
					onExplain={() =>
						actions.sheet.open("explain", {
							month: key,
							figure: data.verdict.lead.figureId,
						})
					}
				/>
			)}
			{notice && (
				<div className="mb-6">
					<BudgetNotice data={data} notice={notice} onAction={actions.notice} />
				</div>
			)}
			<div className="lg:flex lg:items-start lg:gap-12">
				<div className="min-w-0 flex-1">
					{groups.length === 0 ? (
						<p className="text-fg-2 text-body py-12 text-center">
							{t("table.noMatch")}
						</p>
					) : isMobile ? (
						<GroupsList {...list} />
					) : (
						<GroupsTable {...list} columns={columns} />
					)}
				</div>
				<div className="mt-8 lg:mt-0 lg:w-64 lg:shrink-0">
					<BudgetRail actions={actions} data={data} readOnly={closed} />
				</div>
			</div>
		</>
	);
}
