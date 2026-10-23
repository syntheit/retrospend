"use client";

import {
	CalendarX,
	EllipsisIcon,
	FileUp,
	Plus,
	Receipt,
	SearchX,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { PageHeader } from "~/components/layout/page-header";
import { Money } from "~/components/money/money";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Empty } from "~/components/ui/empty-state";
import { Notice } from "~/components/ui/notice";
import { ActivityList } from "./activity-list";
import { ActivityTabs } from "./activity-tabs";
import { ActivityToolbar } from "./activity-toolbar";
import { isFiltered, readFilter } from "./filters";
import { PageFrame } from "./page-frame";
import { useActivity } from "./use-activity";
import { useRowActions } from "./use-row-actions";

const ALL_TIME = { from: null, to: null };

function Overflow() {
	const t = useTranslations("activity.header");
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button aria-label={t("more")} icon kind="ghost">
					<EllipsisIcon />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem asChild>
					<Link href="/import">
						<FileUp aria-hidden="true" />
						{t("import")}
					</Link>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * Activity (activity.html): every entry you are part of, filtered by one
 * state that the list, the count and the footer share (RC4). Add goes
 * through the one global Add; the empty state opens the same sheet.
 */
export function ActivityPage() {
	const t = useTranslations("activity");
	const a = useActivity();
	const actions = useRowActions(a.rows);
	const modal = useExpenseModal();
	// Saves elsewhere (today's expense modal, shared expense actions) refresh
	// this list through the router invalidation map (src/lib/query-invalidation).
	const [compare, setCompare] = useState(false);
	const filtered = isFiltered(a.filter, a.today);
	const allTime = () => a.setFilter({ ...a.filter, range: ALL_TIME });
	const empty = filtered ? (
		<Empty
			action={
				<Button
					kind="secondary"
					onClick={() => {
						a.setSearch("");
						a.setFilter(readFilter(new URLSearchParams(), a.today));
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
	) : a.elsewhere ? (
		<Empty
			action={
				<Button kind="secondary" onClick={allTime} size="sm">
					{t("empty.allTime")}
				</Button>
			}
			hint={t("empty.quietHint")}
			icon={CalendarX}
			title={t("empty.quiet")}
		/>
	) : (
		<Empty
			action={
				<Button kind="primary" onClick={() => modal.openNewExpense()} size="sm">
					<Plus aria-hidden="true" />
					{t("empty.add")}
				</Button>
			}
			hint={t("empty.firstHint")}
			icon={Receipt}
			title={t("empty.first")}
		/>
	);
	return (
		<PageFrame data-page="activity" data-ui="v2">
			<PageHeader
				overflow={<Overflow />}
				sub={a.count != null ? t("header.sub", { count: a.count }) : undefined}
				tabs={<ActivityTabs current="expenses" />}
				title={t("header.title")}
			/>
			<ActivityToolbar
				compare={compare}
				filter={a.filter}
				search={a.search}
				setCompare={setCompare}
				setFilter={a.setFilter}
				setSearch={a.setSearch}
				today={a.today}
			/>
			{compare && (
				<p className="text-fg-2 text-small mb-4">{t("compareUnavailable")}</p>
			)}
			{a.query.isError ? (
				<Notice
					action={
						<Button
							kind="secondary"
							onClick={() => void a.query.refetch()}
							size="sm"
						>
							{t("error.retry")}
						</Button>
					}
					tone="danger"
				>
					{t("error.load")}
				</Notice>
			) : (
				<ActivityList
					dayTotals={a.dayTotals}
					empty={empty}
					handlersFor={actions.handlersFor}
					loading={a.query.isPending}
					onOpen={actions.open}
					rows={a.rows}
					today={a.today}
					total={
						a.total && a.count != null
							? { figure: a.total.figure, count: a.count, total: a.total.value }
							: undefined
					}
				/>
			)}
			{a.total && (
				<p className="text-fg-2 text-small mt-4 md:hidden">
					{t("footer.yourSpending")}{" "}
					<Money
						className="text-fg font-semibold"
						figure={a.total.figure}
						value={a.total.value}
					/>
				</p>
			)}
			{a.query.hasNextPage && (
				<div className="mt-4 flex justify-center">
					<Button
						aria-busy={a.query.isFetchingNextPage || undefined}
						kind="secondary"
						onClick={() => void a.query.fetchNextPage()}
					>
						{t("more")}
					</Button>
				</div>
			)}
		</PageFrame>
	);
}
