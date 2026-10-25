"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { PageFrame } from "~/components/layout/page-frame";
import { PageHeader } from "~/components/layout/page-header";
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import { api } from "~/trpc/react";
import { BudgetSheetsProvider, useBudgetSheet } from "../use-budget-sheet";
import { BudgetToolbar } from "./budget-toolbar";
import { HeaderMenu } from "./header-menu";
import { MonthContent } from "./month-content";
import { useMonthLabel } from "./month-switch";
import { monthRange, parseMonthParam, shiftMonth } from "./months";
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
	hasDebt,
	isFiltered,
	isLimits,
} from "./view-model";

/** The page on a month the server returned. */
function BudgetBody({
	data,
	current,
	today,
	onMonth,
}: {
	data: GetMonthOutput;
	/** The month today is in. */
	current: number;
	/** The month today is in, whole: the plan reads what it spent. */
	today: GetMonthOutput | undefined;
	onMonth: (key: number) => void;
}) {
	const t = useTranslations("budgetPage");
	const actions = useBudgetActions(data);
	const label = useMonthLabel();
	const [query, setQuery] = useState("");
	const [chip, setChip] = useState<Chip | null>(null);
	const closed = data.month.state === "CLOSED";
	const planning = data.month.state === "NEXT";
	const key = data.month.key;
	const filter = { query, chip };
	const groups = useMemo(
		() => filterGroups(data.groups, { query, chip }),
		[data.groups, query, chip],
	);
	return (
		<>
			<PageHeader
				overflow={
					<HeaderMenu
						actions={actions}
						hasDebt={hasDebt(data)}
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
				limits={isLimits(data.book.style)}
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
						<PlanView actions={actions} data={data} thisMonth={today} />
					</div>
					<div className="mt-8 lg:mt-0 lg:w-64 lg:shrink-0">
						<PlanRail month={key} />
					</div>
				</div>
			) : (
				<MonthContent
					actions={actions}
					data={data}
					filtering={isFiltered(filter)}
					groups={groups}
				/>
			)}
			<span className="sr-only">{label(key)}</span>
		</>
	);
}

/**
 * Budget: the month's verdict, then the
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
		body = (
			<BudgetBody
				current={today}
				data={data}
				onMonth={setMonth}
				today={current.data ?? undefined}
			/>
		);
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
	return (
		<BudgetEmpty
			onSetup={
				sheet.has("setup") ? () => sheet.open("setup", { month: 0 }) : undefined
			}
		/>
	);
}
