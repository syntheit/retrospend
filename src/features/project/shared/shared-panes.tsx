"use client";

import { ChartPie, Receipt, SearchX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Section } from "~/components/layout/section";
import { Balance } from "~/components/money/balance";
import { useRowDates } from "~/components/rows/dates";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { TransactionRow } from "~/components/rows/transaction-row";
import type { TransactionVM } from "~/components/rows/types";
import { TransactionTable } from "~/components/table/transaction-table";
import { Face } from "~/components/ui/avatar-face";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { SkeletonRows } from "~/components/ui/skeleton";
import { useIsMobile } from "~/hooks/use-mobile";
import { DayGroups } from "../day-groups";
import {
	applyFilters,
	ExpenseFilters,
	type Filters,
	isFiltered,
	NO_FILTERS,
} from "../expense-filters";
import { WhoPaysWhom } from "../settle-section";
import { ByCategory, Payments, WhoPaidWhat } from "../summary-pane";
import {
	figureFor,
	lineIn,
	type PageView,
	type Summary,
	toTransaction,
} from "../types";

/** Expenses, read only: the same toolbar and table or day list, no row actions. */
export function SharedExpenses({ view, me }: { view: PageView; me: string }) {
	const t = useTranslations("projectV2.expenses");
	const ts = useTranslations("projectShared.expenses");
	const phone = useIsMobile();
	const [f, setF] = useState<Filters>(NO_FILTERS);
	const rows = useMemo(
		() => applyFilters(view.expenses, f),
		[view.expenses, f],
	);
	if (view.expenses.length === 0)
		return <Empty hint={ts("emptyHint")} icon={Receipt} title={t("empty")} />;
	// A table sorts on one currency's minor units only (a comparison, not a sum).
	const oneCurrency =
		new Set(view.expenses.map((r) => r.amount.currency)).size <= 1;
	const txs = rows.map((r) => ({
		...toTransaction(r, me),
		sortKey: oneCurrency ? r.amount.minor : null,
	}));
	const list =
		rows.length === 0 ? (
			<Empty
				action={
					<Button kind="secondary" onClick={() => setF(NO_FILTERS)} size="sm">
						{t("clear")}
					</Button>
				}
				icon={SearchX}
				title={t("noMatch")}
			/>
		) : phone ? (
			<DayGroups
				row={(tx: TransactionVM) => (
					<TransactionRow hideProject key={tx.id} today={view.today} tx={tx} />
				)}
				rows={txs}
				today={view.today}
			/>
		) : (
			<TransactionTable
				ledger="project"
				rows={txs}
				selectable={false}
				solo={view.solo}
				sort={[{ id: "date", desc: true }]}
				today={view.today}
			/>
		);
	return (
		<section aria-label={t("label")}>
			<ExpenseFilters onChange={setF} value={f} view={view} />
			{list}
			<p className="text-fg-3 text-small mt-3">
				{isFiltered(f)
					? t("shownOf", { shown: rows.length, count: view.expenseCount })
					: t("count", { count: view.expenseCount })}
			</p>
		</section>
	);
}

/** Your balance with each person in this project; a guest reads it, nothing to settle here. */
function YouAndEach({ view }: { view: PageView }) {
	const t = useTranslations("projectV2.summary");
	const others = view.members.filter((m) => !m.isMe);
	return (
		<RowList label={t("youAndEach")}>
			{others.map((m) => (
				<Row
					end={
						<Balance
							amount={
								lineIn(m.withMe, view.primaryCurrency) ?? {
									minor: 0,
									currency: view.primaryCurrency,
								}
							}
							figure={figureFor("balance.person", view.id, m.id)}
						/>
					}
					key={m.id}
					lead={<Face imageUrl={m.imageUrl} name={m.name} size="md" />}
					sub={<RowSub parts={[t(`roles.${m.role}`)]} />}
					title={m.name}
				/>
			))}
		</RowList>
	);
}

/**
 * Summary for a guest or a viewer link: who paid what, who pays whom, your
 * balances (a guest has them, a viewer link has none), spending by category
 * and the payments. The public page shows spending by category only.
 */
export function SharedSummary({
	view,
	summary,
	me,
	isPublic,
}: {
	view: PageView;
	summary: Summary | undefined;
	me: string;
	isPublic: boolean;
}) {
	const t = useTranslations("projectV2.summary");
	if (view.expenseCount === 0)
		return <Empty hint={t("emptyHint")} icon={ChartPie} title={t("empty")} />;
	if (isPublic || view.solo) return <ByCategory view={view} />;
	if (!summary) return <SkeletonRows count={6} />;
	const hasMe = view.members.some((m) => m.isMe);
	return (
		<>
			<WhoPaidWhat me={me} s={summary} view={view} />
			<Section title={t("settleUp")}>
				<h3 className="text-fg text-body mt-2 mb-1 font-medium">
					{t("whoPaysWhom")}
				</h3>
				<WhoPaysWhom me={me} summary={summary} />
				{hasMe ? (
					<>
						<h3 className="text-fg text-body mt-6 mb-1 font-medium">
							{t("youAndEach")}
						</h3>
						<YouAndEach view={view} />
					</>
				) : null}
			</Section>
			<ByCategory view={view} />
			<Payments me={me} view={view} />
		</>
	);
}

/** People, read only: each person with their role and dates. */
export function SharedPeople({ view }: { view: PageView }) {
	const t = useTranslations("projectV2.people");
	const { short } = useRowDates();
	const line = (m: PageView["members"][number]) =>
		[
			t(`roles.${m.role}`),
			m.joinedOn ? t("since", { date: short(m.joinedOn) }) : null,
			m.leftOn ? t("left", { date: short(m.leftOn) }) : null,
		]
			.filter(Boolean)
			.join(" · ");
	return (
		<Section count={view.members.length} id="people" title={t("title")}>
			<RowList label={t("title")}>
				{view.members.map((m) => (
					<Row
						end={
							m.isMe || m.withMe.length === 0 ? null : (
								<Balance
									amount={
										lineIn(m.withMe, view.primaryCurrency) ?? {
											minor: 0,
											currency: view.primaryCurrency,
										}
									}
									figure={figureFor("balance.person", view.id, m.id)}
								/>
							)
						}
						key={m.id}
						lead={<Face imageUrl={m.imageUrl} name={m.name} size="md" />}
						sub={<RowSub parts={[line(m)]} />}
						title={m.name}
						titleEnd={
							m.isMe ? (
								<span className="text-fg-3 text-meta">{t("you")}</span>
							) : null
						}
					/>
				))}
			</RowList>
		</Section>
	);
}
