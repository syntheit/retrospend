"use client";

import type { Span } from "@retrospend/domain/insights";
import { ChartPie, SearchX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { PageFrame } from "~/components/layout/page-frame";
import { PageHeader } from "~/components/layout/page-header";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { ActivityTabs } from "../activity/activity-tabs";
import { useDimItems } from "../activity/activity-toolbar";
import { CashflowSection } from "./cashflow-section";
import { CategorySection } from "./category-section";
import { activityHref, type InsightsView, isNarrowed } from "./filter";
import { InsightsToolbar } from "./insights-toolbar";
import { MonthsSection } from "./months-section";
import { LeadSkeleton, PartUnavailable } from "./part-states";
import { SummaryLead } from "./summary-lead";
import { useInsights } from "./use-insights";
import { YtdSection } from "./ytd-section";

/** The names of what the chips picked, "Groceries, Martín", for the sentence. */
function useNames(view: InsightsView): string {
	const items = useDimItems();
	const label = (dim: "cats" | "people" | "projects") =>
		view[dim].map((id) => items[dim].find((i) => i.id === id)?.label ?? id);
	return [...label("cats"), ...label("people"), ...label("projects")].join(
		", ",
	);
}

/**
 * Insights (insights.html): a tab inside Activity. One total, then three
 * answers: where it went (by category), how it moved (month by month and
 * against last year) and what came in. Every figure is the server's and
 * opens the expenses behind it in Activity; nothing here adds money.
 */
export function InsightsPage() {
	const t = useTranslations("insights");
	const i = useInsights();
	const modal = useExpenseModal();
	const { view, today } = i;
	const names = useNames(view);
	const hrefOf = useCallback(
		(span?: Span, cat?: string) =>
			activityHref(view, today, {
				...(span ? { span } : {}),
				...(cat ? { cat } : {}),
			}),
		[view, today],
	);
	const categoryHref = useCallback(
		(cat: string) => hrefOf(undefined, cat),
		[hrefOf],
	);
	const spanHref = useCallback((span: Span) => hrefOf(span), [hrefOf]);
	const summary = i.summary.data;
	const narrowed = isNarrowed(view);
	const named = summary?.missingRates ?? [];
	const nothing = summary?.count === 0;

	return (
		<PageFrame label="insights">
			<PageHeader
				tabs={<ActivityTabs current="insights" />}
				title={t("header.title")}
			/>
			<InsightsToolbar setView={i.setView} today={today} view={view} />
			{nothing ? (
				<Empty
					action={
						narrowed ? (
							<Button
								kind="secondary"
								onClick={() =>
									i.setView({ ...view, cats: [], people: [], projects: [] })
								}
								size="sm"
							>
								{t("empty.clear")}
							</Button>
						) : (
							<Button
								kind="primary"
								onClick={() => modal.openNewExpense()}
								size="sm"
							>
								{t("empty.add")}
							</Button>
						)
					}
					hint={narrowed ? t("empty.filteredHint") : t("empty.rangeHint")}
					icon={narrowed ? SearchX : ChartPie}
					title={narrowed ? t("empty.filtered") : t("empty.range")}
				/>
			) : (
				<>
					{summary ? (
						<div aria-busy={i.summary.isPlaceholderData || undefined}>
							<SummaryLead
								href={(span) => hrefOf(span)}
								names={names}
								range={view.range}
								summary={summary}
								today={today}
							/>
						</div>
					) : i.summary.isError ? (
						<div className="mb-8">
							<PartUnavailable onRetry={() => void i.summary.refetch()} />
						</div>
					) : (
						<LeadSkeleton />
					)}
					<div className="lg:grid lg:grid-cols-5 lg:items-start lg:gap-12">
						<div className="min-w-0 lg:col-span-3">
							<CategorySection
								compare={view.compare}
								hrefOf={categoryHref}
								query={i.summary}
							/>
							<YtdSection
								hrefOf={hrefOf}
								named={named}
								query={i.ytd}
								today={today}
							/>
						</div>
						<div className="mt-8 min-w-0 lg:col-span-2 lg:mt-0">
							<MonthsSection hrefOf={spanHref} query={i.months} />
							{i.showCashflow && (
								<CashflowSection named={named} query={i.cashflow} />
							)}
						</div>
					</div>
				</>
			)}
		</PageFrame>
	);
}
