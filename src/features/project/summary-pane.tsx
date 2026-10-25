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
const biggestFirst = (a: RankedItem, b: RankedItem) => {
	const [x, y] = [a.value?.minor ?? 0, b.value?.minor ?? 0];
	return x === y ? 0 : x > y ? -1 : 1;
};

const inCur = <T extends { currency: string }>(
	lines: readonly T[],
	cur: string,
) => lines.find((l) => l.currency === cur);

/** Who paid what: each person's Paid or Share in the project's currency. */
function WhoPaidWhat({
	view,
	s,
	me,
}: {
	view: PageView;
	s: Summary;
	me: string;
}) {
	const t = useTranslations("projectV2.summary");
	const [who, setWho] = useState<"paid" | "share">("paid");
	const cur = view.primaryCurrency;
	const people: RankedItem[] = s.members.flatMap((m) => {
		const line = inCur(m.lines, cur);
		const label = m.key === me ? t("you") : m.name;
		const figure = figureFor(`project.member.${who}`, view.id, m.key);
		return line ? [{ id: m.key, label, value: line[who], figure }] : [];
	});
	const total = inCur(view.total, cur);
	return (
		<Section
			end={
				<Segmented
					label={t("whoPaidWhat")}
					onChange={setWho}
					options={[
						{ value: "paid", label: t("paid") },
						{ value: "share", label: t("share") },
					]}
					value={who}
				/>
			}
			id="who-paid"
			title={t("whoPaidWhat")}
		>
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
	);
}

/** Spending by category, the group's or yours, in the project's currency. */
function ByCategory({ view }: { view: PageView }) {
	const t = useTranslations("projectV2.summary");
	const [cats, setCats] = useState<"group" | "mine">("group");
	const cur = view.primaryCurrency;
	const items: RankedItem[] = view.byCategory.flatMap((c) => {
		const value = inCur(cats === "group" ? c.group : c.mine, cur);
		if (!value || value.minor === 0) return [];
		const name = c.name ?? t("uncategorized");
		const category = { name, icon: c.icon, tone: categoryTone(c.color ?? "") };
		return [{ id: c.id ?? "none", label: name, value, category }];
	});
	return (
		<Section
			end={
				view.solo ? (
					<span className="text-fg-3 text-small">{cur}</span>
				) : (
					<Segmented
						label={t("byCategoryGroup")}
						onChange={setCats}
						options={[
							{ value: "group", label: t("group") },
							{ value: "mine", label: t("yours") },
						]}
						value={cats}
					/>
				)
			}
			id="by-category"
			title={view.solo ? t("byCategory") : t("byCategoryGroup")}
		>
			<div className="max-w-180">
				<RankedBars items={[...items].sort(biggestFirst)} />
			</div>
		</Section>
	);
}

/** The payments recorded in this project. */
function Payments({ view, me }: { view: PageView; me: string }) {
	const t = useTranslations("projectV2.summary");
	return (
		<Section count={view.payments.length} id="payments" title={t("payments")}>
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
	);
}

/**
 * Summary (owner, 2026-08-04): leads with the total and what each person
 * spent, then Settle up, then spending by category and the payments. Every
 * amount is in the project's currency; others are never converted.
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
	if (view.expenseCount === 0)
		return <Empty hint={t("emptyHint")} icon={ChartPie} title={t("empty")} />;
	if (!summary) return <SkeletonRows count={6} />;
	if (view.solo) return <ByCategory view={view} />;
	return (
		<>
			<WhoPaidWhat me={me} s={summary} view={view} />
			<SettleSection
				me={me}
				onSettleAll={onSettleAll}
				summary={summary}
				view={view}
			/>
			<ByCategory view={view} />
			<Payments me={me} view={view} />
		</>
	);
}
