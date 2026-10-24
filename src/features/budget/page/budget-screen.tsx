"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { PageFrame } from "~/components/layout/page-frame";
import { PageHeader } from "~/components/layout/page-header";
import { useRowDates } from "~/components/rows/dates";
import { useIsMobile } from "~/hooks/use-mobile";
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import { api } from "~/trpc/react";
import { BudgetSheetsProvider, useBudgetSheet } from "../use-budget-sheet";
import { BudgetNotice } from "./budget-notice";
import { BudgetRail } from "./budget-rail";
import { BudgetToolbar } from "./budget-toolbar";
import { ClosedHero } from "./closed-hero";
import { GroupsList } from "./groups-list";
import { GroupsTable } from "./groups-table";
import { HeaderMenu } from "./header-menu";
import { BudgetHero } from "./hero";
import { MonthSwitch, useMonthLabel } from "./month-switch";
import {
	monthRange,
	monthStartIso,
	parseMonthParam,
	shiftMonth,
} from "./months";
import { PlanRail } from "./plan-rail";
import { PlanView } from "./plan-view";
import {
	BudgetEmpty,
	BudgetPaused,
	BudgetSkeleton,
	BudgetUnavailable,
} from "./states";
import { useBudgetActions } from "./use-budget-actions";
import {
	type Chip,
	filterGroups,
	groupKey,
	groupStartsOpen,
	isFiltered,
	isLimits,
	namesById,
	pickNotice,
} from "./view-model";

/** The page on a month the server returned. */
function BudgetBody({
	data,
	current,
	onMonth,
}: {
	data: GetMonthOutput;
	/** The month today is in. */
	current: number;
	onMonth: (key: number) => void;
}) {
	const t = useTranslations("budgetPage");
	const isMobile = useIsMobile();
	const actions = useBudgetActions(data);
	const label = useMonthLabel();
	const { month: monthName } = useRowDates();
	const welcome = api.envelope.welcomeBackState.useQuery(undefined, {
		enabled: !data.book.paused,
		staleTime: 60_000,
	});
	const [query, setQuery] = useState("");
	const [chip, setChip] = useState<Chip | null>(null);
	const [folds, setFolds] = useState<Record<string, boolean>>({});
	const closed = data.month.state === "CLOSED";
	const planning = data.month.state === "NEXT";
	const names = useMemo(() => namesById(data.groups), [data.groups]);
	const filter = { query, chip };
	const groups = useMemo(
		() => filterGroups(data.groups, { query, chip }),
		[data.groups, query, chip],
	);
	const notice = closed ? null : pickNotice(data, welcome.data, names);
	const key = data.month.key;
	const missing = [...new Set(data.missingRates.map((m) => m.currency))];
	const limits = isLimits(data.book.style);
	const columns = closed ? "closed" : limits ? "limits" : "plan";
	const common = {
		groups,
		actions,
		readOnly: closed,
		filtering: isFiltered(filter),
		isOpen: (g: GetMonthOutput["groups"][number]) =>
			folds[groupKey(g)] ?? groupStartsOpen(data.book.style, g),
		onToggle: (g: GetMonthOutput["groups"][number]) =>
			setFolds((f) => ({
				...f,
				[groupKey(g)]: !(f[groupKey(g)] ?? groupStartsOpen(data.book.style, g)),
			})),
	};
	return (
		<>
			<PageHeader
				overflow={
					<HeaderMenu
						actions={actions}
						month={key}
						onPlan={() => onMonth(shiftMonth(current, 1))}
						readOnly={closed}
					/>
				}
				title={t("title")}
			/>
			<BudgetToolbar
				chip={chip}
				current={current}
				data={data}
				limits={limits}
				months={monthRange(data.book.startMonth, current)}
				onChip={setChip}
				onMonth={onMonth}
				onQuery={setQuery}
				planning={planning}
				query={query}
			/>
			{planning ? (
				<div className="lg:flex lg:items-start lg:gap-12">
					<div className="min-w-0 flex-1">
						<PlanView actions={actions} data={data} />
					</div>
					<div className="mt-8 lg:mt-0 lg:w-64 lg:shrink-0">
						<PlanRail month={key} />
					</div>
				</div>
			) : (
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
							<BudgetNotice
								data={data}
								notice={notice}
								onAction={actions.notice}
							/>
						</div>
					)}
					<div className="lg:flex lg:items-start lg:gap-12">
						<div className="min-w-0 flex-1">
							{groups.length === 0 ? (
								<p className="text-fg-2 text-body py-12 text-center">
									{t("table.noMatch")}
								</p>
							) : isMobile ? (
								<GroupsList {...common} />
							) : (
								<GroupsTable {...common} columns={columns} />
							)}
						</div>
						<div className="mt-8 lg:mt-0 lg:w-64 lg:shrink-0">
							<BudgetRail actions={actions} data={data} readOnly={closed} />
						</div>
					</div>
				</>
			)}
			<span className="sr-only">{label(key)}</span>
		</>
	);
}

/**
 * Budget (uiV2 with the envelope budget on): the month's verdict, then the
 * envelopes by group, with who owes you beside them. One month at a time:
 * the URL names it (`?month=202610`) and `view=plan` opens the month after
 * this one, where the plan is made. Every read is the server's; each action
 * opens a sheet by id (use-budget-sheet).
 */
export function BudgetScreen() {
	const t = useTranslations("budgetPage");
	const router = useRouter();
	const pathname = usePathname();
	const params = useSearchParams();
	const utils = api.useUtils();
	const current = api.envelope.getMonth.useQuery({});
	const today = current.data?.month.key ?? null;
	const wanted =
		params.get("view") === "plan" && today
			? shiftMonth(today, 1)
			: parseMonthParam(params.get("month"));
	const other = wanted != null && today != null && wanted !== today;
	const picked = api.envelope.getMonth.useQuery(
		{ month: wanted ?? undefined },
		{ enabled: other },
	);
	const shown = other ? picked : current;
	const data = shown.data;
	const resume = api.envelope.resume.useMutation({
		onSuccess: () => utils.envelope.invalidate(),
	});

	const setMonth = (key: number) => {
		const next = new URLSearchParams(params.toString());
		next.delete("view");
		if (key === today) next.delete("month");
		else next.set("month", String(key));
		const qs = next.toString();
		router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
	};

	const full =
		data != null &&
		today != null &&
		current.data != null &&
		!current.data.book.paused;
	let body: React.ReactNode;
	if (full)
		body = <BudgetBody current={today} data={data} onMonth={setMonth} />;
	else if (current.isPending || (other && picked.isPending))
		body = <BudgetSkeleton />;
	else if (current.isError || (other && picked.isError))
		body = (
			<BudgetUnavailable
				onRetry={() => {
					void current.refetch();
					if (other) void picked.refetch();
				}}
			/>
		);
	else if (current.data?.book.paused)
		body = (
			<BudgetPaused
				onResume={() => resume.mutate()}
				resuming={resume.isPending}
			/>
		);
	else body = <NoBook />;

	return (
		<BudgetSheetsProvider>
			<PageFrame label="budget">
				{full ? null : <PageHeader title={t("title")} />}
				{body}
			</PageFrame>
		</BudgetSheetsProvider>
	);
}

/** No book: setup is a sheet (month 0: none yet), so the page only hands off to it. */
function NoBook() {
	const sheet = useBudgetSheet();
	return <BudgetEmpty onSetup={() => sheet.open("setup", { month: 0 })} />;
}
