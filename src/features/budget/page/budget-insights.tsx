"use client";

import { useTranslations } from "next-intl";
import { MonthlyBars } from "~/components/charts/monthly-bars";
import { Section } from "~/components/layout/section";
import { Money } from "~/components/money/money";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { RowBar } from "~/components/rows/lead";
import { Skeleton } from "~/components/ui/skeleton";
import type { BudgetInsights as Insights } from "~/lib/schemas/envelope-insights";
import { api } from "~/trpc/react";

/** "202610" as the ISO date the month chart reads. */
const isoMonth = (key: number) =>
	`${Math.floor(key / 100)}-${String(key % 100).padStart(2, "0")}-01`;

/** Envelopes and an amount each, flat rows under a small heading. */
function Ranked({
	title,
	rows,
	tone,
}: {
	title: string;
	rows: { id: string; name: string; amount: Insights["spent"] }[];
	tone: "over" | "room";
}) {
	if (rows.length === 0) return null;
	return (
		<div className="min-w-0">
			<h3 className="text-fg-2 text-small mb-1">{title}</h3>
			<RowList label={title} variant="flat">
				{rows.map((r) => (
					<Row
						end={
							<Money
								className={
									tone === "over"
										? "text-attention-text font-semibold"
										: "font-semibold"
								}
								value={r.amount}
							/>
						}
						key={r.id}
						title={r.name}
					/>
				))}
			</RowList>
		</div>
	);
}

/**
 * Budget insights, flat, under the envelopes (the empty space of a short
 * list, R26): how much of what the month
 * planned is spent, the envelopes furthest over and with the most room, and
 * the last months' spending. Every figure is the server's (envelope.insights).
 * Nothing shows until there is a plan or spending to talk about.
 */
export function BudgetInsights({ month }: { month: number }) {
	const t = useTranslations("budgetPage.insights");
	const q = api.envelope.insights.useQuery({ month }, { staleTime: 60_000 });
	const d = q.data;
	if (q.isPending)
		return (
			<Section className="mt-8" id="insights" title={t("title")}>
				<Skeleton className="h-16 w-full" />
			</Section>
		);
	if (!d || (d.planned.minor === 0 && d.spent.minor === 0)) return null;
	return (
		<Section className="mt-8" id="insights" title={t("title")}>
			<p className="text-body text-fg">
				{t.rich("spent", {
					spent: () => <Money className="font-semibold" value={d.spent} />,
					planned: () => <Money value={d.planned} />,
				})}
			</p>
			{d.basis !== null && (
				<RowBar basis={d.basis} label={t("bar")} over={d.over} />
			)}
			{d.incomplete && (
				<RowSub parts={[t("incomplete")]} wrap />
			)}
			<div className="mt-4 grid gap-x-12 gap-y-4 md:grid-cols-2">
				<Ranked
					rows={d.mostOver.map((e) => ({
						id: e.id,
						name: e.name,
						amount: e.over,
					}))}
					title={t("mostOver")}
					tone="over"
				/>
				<Ranked
					rows={d.mostRoom.map((e) => ({
						id: e.id,
						name: e.name,
						amount: e.left,
					}))}
					title={t("mostRoom")}
					tone="room"
				/>
			</div>
			{d.trend.length >= 2 && (
				<div className="mt-4">
					<h3 className="text-fg-2 text-small mb-1">{t("trend")}</h3>
					<MonthlyBars
						currency={d.spent.currency}
						height={160}
						months={d.trend.map((p) => ({
							month: isoMonth(p.month),
							total: p.spent,
						}))}
					/>
				</div>
			)}
		</Section>
	);
}
