"use client";

import { ChartPie } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { RankedBars, type RankedItem } from "~/components/charts/ranked-bars";
import { Section } from "~/components/layout/section";
import { Money } from "~/components/money/money";
import { RowList } from "~/components/rows/row";
import { TransactionRow } from "~/components/rows/transaction-row";
import { Empty } from "~/components/ui/empty-state";
import { Segmented } from "~/components/ui/segmented";
import { SkeletonRows } from "~/components/ui/skeleton";
import { categoryTone } from "~/lib/category-tone";
import { SettleSection } from "./settle-section";
import { figureFor, type PageView, type Summary } from "./types";

/** Biggest first: a comparison of two amounts in one currency, not arithmetic. */
const biggestFirst = (a: RankedItem, b: RankedItem) =>
	a.value.minor === b.value.minor ? 0 : a.value.minor > b.value.minor ? -1 : 1;

const inCur = <T extends { currency: string }>(
	lines: readonly T[],
	cur: string,
) => lines.find((l) => l.currency === cur);

/**
 * Summary (owner, 2026-08-04): leads with the total and what each person
 * spent (Paid or Share, from the summary read), then Settle up, then
 * spending by category (the group's or yours) and the payments in the
 * project. Every amount is in the project's currency; other currencies are
 * listed apart, never converted.
 */
export function SummaryPane({
	view,
	summary,
	me,
	onSettleAll,
}: {
	view: PageView;
	summary: Summary | undefined;
	me: string;
	onSettleAll: () => void;
}) {
	const t = useTranslations("projectV2.summary");
	const [who, setWho] = useState<"paid" | "share">("paid");
	const [cats, setCats] = useState<"group" | "mine">("group");
	const cur = view.primaryCurrency;
	if (view.expenseCount === 0)
		return <Empty hint={t("emptyHint")} icon={ChartPie} title={t("empty")} />;
	if (!summary) return <SkeletonRows count={6} />;
	const s = summary;
	const people: RankedItem[] = s.members.flatMap((m) => {
		const line = inCur(m.lines, cur);
		return line
			? [
					{
						id: m.key,
						label: m.key === me ? t("you") : m.name,
						value: line[who],
					},
				]
			: [];
	});
	const total = inCur(view.total, cur);
	const categories: RankedItem[] = view.byCategory.flatMap((c) => {
		const value = inCur(cats === "group" ? c.group : c.mine, cur);
		if (!value || value.minor === 0) return [];
		const name = c.name ?? t("uncategorized");
		return [
			{
				id: c.id ?? "none",
				label: name,
				value,
				category: { name, icon: c.icon, tone: categoryTone(c.color ?? "") },
			},
		];
	});
	return (
		<>
			{view.solo ? null : (
				<Section title={t("whoPaidWhat")}>
					<div className="mb-3 flex items-center justify-between gap-2">
						<span className="text-fg-3 text-small">{cur}</span>
						<Segmented
							label={t("whoPaidWhat")}
							onChange={setWho}
							options={[
								{ value: "paid", label: t("paid") },
								{ value: "share", label: t("share") },
							]}
							value={who}
						/>
					</div>
					<div className="max-w-180">
						<RankedBars items={[...people].sort(biggestFirst)} />
					</div>
					{total ? (
						<p className="text-fg-3 text-small mt-3">
							{s.balancesAddUp
								? t.rich("addsUp", {
										amount: () => (
											<Money
												figure={figureFor("project.total", view.id)}
												value={total}
											/>
										),
									})
								: t("doesNotAddUp")}
						</p>
					) : null}
				</Section>
			)}
			{view.solo ? null : (
				<SettleSection
					me={me}
					onSettleAll={onSettleAll}
					summary={s}
					view={view}
				/>
			)}
			<Section title={view.solo ? t("byCategory") : t("byCategoryGroup")}>
				{view.solo ? null : (
					<div className="mb-3 flex justify-end">
						<Segmented
							label={t("byCategoryGroup")}
							onChange={setCats}
							options={[
								{ value: "group", label: t("group") },
								{ value: "mine", label: t("yours") },
							]}
							value={cats}
						/>
					</div>
				)}
				<div className="max-w-180">
					<RankedBars items={[...categories].sort(biggestFirst)} />
				</div>
			</Section>
			{view.solo ? null : (
				<Section count={view.payments.length} title={t("payments")}>
					{view.payments.length === 0 ? (
						<p className="text-fg-2 text-small">{t("noPayments")}</p>
					) : (
						<RowList label={t("payments")}>
							{view.payments.map((p) => (
								<TransactionRow
									key={p.id}
									showDate
									today={view.today}
									tx={{
										id: p.id,
										title: t("paidTo", {
											from: p.from.id === me ? t("you") : p.from.name,
											to: p.to.id === me ? t("youObject") : p.to.name,
										}),
										kind: "payment",
										category: null,
										amount: p.amount,
										reviewed: true,
										pending: p.pending,
										date: p.date,
									}}
								/>
							))}
						</RowList>
					)}
				</Section>
			)}
		</>
	);
}
