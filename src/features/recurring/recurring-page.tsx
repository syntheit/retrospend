"use client";

import { Plus, Repeat, Search, SearchX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { PageHeader } from "~/components/layout/page-header";
import { Section } from "~/components/layout/section";
import { Toolbar } from "~/components/layout/toolbar";
import { RowList } from "~/components/rows/row";
import { TransactionRow } from "~/components/rows/transaction-row";
import { TableSkeleton } from "~/components/table/table-skeleton";
import { Button } from "~/components/ui/button";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { Empty } from "~/components/ui/empty-state";
import { Input } from "~/components/ui/input";
import { Notice } from "~/components/ui/notice";
import { SkeletonRows } from "~/components/ui/skeleton";
import { useIsMobile } from "~/hooks/use-mobile";
import type { RecurringView } from "~/server/services/recurring-view.service";
import { ActivityTabs } from "../activity/activity-tabs";
import { PageFrame } from "../activity/page-frame";
import { toTransactionVM } from "../activity/to-vm";
import { groupsOf, matches, type RecurringChips } from "./groups";
import { RecurringList } from "./recurring-list";
import { RecurringSummary } from "./recurring-summary";
import { RecurringTable } from "./recurring-table";
import { useRecurring } from "./use-recurring";

const NO_CHIPS: RecurringChips = {
	autoPayOn: false,
	autoPayOff: false,
	foreign: false,
};

/** This month's entries logged by auto-pay, linking to Activity. */
function Logged({ view }: { view: RecurringView }) {
	const t = useTranslations("activityRecurring");
	if (!view.logged.length) return null;
	return (
		<Section
			action={{ label: t("logged.see"), href: "/activity" }}
			className="mt-8"
			count={view.logged.length}
			id="logged"
			title={t("logged.title")}
		>
			<RowList label={t("logged.title")}>
				{view.logged.map((row) => (
					<TransactionRow
						key={row.id}
						showDate
						today={view.today}
						tx={toTransactionVM(row, () => "")}
					/>
				))}
			</RowList>
		</Section>
	);
}

/** The Recurring skeleton (also the route's fallback). */
export function RecurringSkeleton() {
	return (
		<>
			<TableSkeleton className="max-md:hidden" rows={6} />
			<SkeletonRows className="md:hidden" count={6} />
		</>
	);
}

/**
 * Recurring (recurring.html): a tab inside Activity. One list grouped by
 * due date, one summary line with a period switch; the calendar, the
 * projections and the stat cards are gone (IMPLEMENTATION §3).
 */
export function RecurringPage() {
	const t = useTranslations("activityRecurring");
	const phone = useIsMobile();
	const r = useRecurring();
	const [q, setQ] = useState("");
	const [chips, setChips] = useState<RecurringChips>(NO_CHIPS);
	const data = r.view.data;
	const groups = useMemo(() => {
		if (!data) return [];
		const shown = data.items.filter((x) =>
			matches(x, q, chips, data.homeCurrency),
		);
		return groupsOf(shown, data.today);
	}, [data, q, chips]);
	const out = data?.items.filter((x) => x.direction === "out").length ?? 0;
	const income = (data?.items.length ?? 0) - out;
	const chip = (key: keyof RecurringChips, label: string) => (
		<FilterChip
			onClick={() => setChips({ ...chips, [key]: !chips[key] })}
			selected={chips[key]}
		>
			{label}
		</FilterChip>
	);
	const add = (
		<Button kind="primary" onClick={r.openNew}>
			<Plus aria-hidden="true" />
			{t("add")}
		</Button>
	);
	// Phones keep the header to the title: the primary is a + (recurring.html phone).
	const headerAdd = phone ? (
		<Button aria-label={t("add")} icon kind="ghost" onClick={r.openNew}>
			<Plus aria-hidden="true" />
		</Button>
	) : (
		add
	);
	let body: React.ReactNode;
	if (r.view.isPending) body = <RecurringSkeleton />;
	else if (r.view.isError || !data)
		body = (
			<Notice
				action={
					<Button
						kind="secondary"
						onClick={() => void r.view.refetch()}
						size="sm"
					>
						{t("error.retry")}
					</Button>
				}
				tone="danger"
			>
				{t("error.load")}
			</Notice>
		);
	else if (!data.items.length)
		body = (
			<Empty
				action={add}
				hint={t("empty.hint")}
				icon={Repeat}
				title={t("empty.title")}
			/>
		);
	else {
		const list = {
			groups,
			today: data.today,
			handlersFor: r.handlersFor,
			onConfirm: r.confirmOne,
			onOpen: (x: { id: string }) => r.edit(x.id),
		};
		body = (
			<>
				<Toolbar
					label={t("toolbar.label")}
					search={
						<div className="relative max-md:w-full">
							<Search
								aria-hidden="true"
								className="text-fg-3 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
							/>
							<Input
								aria-label={t("toolbar.search")}
								className="h-ctl w-60 pl-9 max-md:w-full"
								onChange={(e) => setQ(e.target.value)}
								placeholder={t("toolbar.search")}
								type="search"
								value={q}
							/>
						</div>
					}
				>
					<FilterChips>
						{chip("autoPayOn", t("toolbar.autoPayOn"))}
						{chip("autoPayOff", t("toolbar.autoPayOff"))}
						{chip("foreign", t("toolbar.foreign"))}
					</FilterChips>
				</Toolbar>
				<RecurringSummary income={data.in} out={data.out} />
				{groups.length === 0 ? (
					<Empty
						action={
							<Button
								kind="secondary"
								onClick={() => {
									setQ("");
									setChips(NO_CHIPS);
								}}
								size="sm"
							>
								{t("empty.reset")}
							</Button>
						}
						hint={t("empty.noMatchHint")}
						icon={SearchX}
						title={t("empty.noMatch")}
					/>
				) : phone ? (
					<RecurringList {...list} />
				) : (
					<RecurringTable {...list} onAutoPay={r.setAutoPay} />
				)}
				<Logged view={data} />
			</>
		);
	}
	return (
		<PageFrame data-page="recurring" data-ui="v2">
			<PageHeader
				primary={headerAdd}
				sub={data ? t("sub", { out, income }) : undefined}
				tabs={<ActivityTabs current="recurring" />}
				title={t("title")}
			/>
			{body}
		</PageFrame>
	);
}
