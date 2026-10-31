"use client";

import type { Span } from "@retrospend/domain/insights";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { MonthlyBars } from "~/components/charts/monthly-bars";
import { Section } from "~/components/layout/section";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import { Button } from "~/components/ui/button";
import { useIsMobile } from "~/hooks/use-mobile";
import type { MonthBar, MonthsDTO } from "~/server/services/insights/types";
import { monthFigure, monthTotals } from "./insights-vm";
import { ChartSkeleton, type PartQuery, PartUnavailable } from "./part-states";

const HEIGHT = { desktop: 180, phone: 160 };

/** A month with spending: the only kind a pick can land on, as the others have no bar. */
const spent = (bar: MonthBar) => (bar.total?.minor ?? 0) > 0;

/** The bar for the range: the month it is exactly, else the one it ends in. */
function selectedBar(months: readonly MonthBar[], range: Span): number {
	const exact = months.findIndex(
		(m) => m.span.from === range.from && m.span.to === range.to,
	);
	if (exact >= 0) return exact;
	const ends = months.findIndex(
		(m) => m.span.from <= range.to && range.to <= m.span.to,
	);
	return ends >= 0 ? ends : months.length - 1;
}

/**
 * Month by month: the last six months of the same filters, the month the
 * range covers highlighted. A bar picks that month in place: the range
 * becomes the month and the figures below follow. The drawing is for sight
 * only, so the same months follow as buttons (hidden until one has focus)
 * with each month's figure, for keyboards and screen readers.
 */
export function MonthsSection({
	query,
	span,
	onPick,
}: {
	query: PartQuery<MonthsDTO>;
	/** The range the page shows. */
	span: Span;
	onPick: (month: Span) => void;
}) {
	const t = useTranslations("insights.months");
	const phone = useIsMobile();
	const { month } = useRowDates();
	const data = query.data;
	const totals = useMemo(() => (data ? monthTotals(data.months) : []), [data]);
	const on = data ? selectedBar(data.months, span) : -1;
	return (
		<Section id="by-month" title={t("title")}>
			{query.isPending ? (
				<ChartSkeleton height={phone ? HEIGHT.phone : HEIGHT.desktop} />
			) : query.isError || !data ? (
				<PartUnavailable onRetry={() => void query.refetch()} />
			) : (
				<div aria-busy={query.isPlaceholderData || undefined}>
					<MonthlyBars
						currency={data.home}
						height={phone ? HEIGHT.phone : HEIGHT.desktop}
						highlight={on}
						months={totals}
						onSelect={(i) => {
							const bar = data.months[i];
							if (bar && spent(bar)) onPick(bar.span);
						}}
					/>
					<ul
						aria-label={t("list")}
						className="sr-only focus-within:not-sr-only focus-within:mt-2 focus-within:flex focus-within:flex-wrap focus-within:gap-x-2 focus-within:gap-y-1"
					>
						{data.months.flatMap((bar, i) =>
							spent(bar) ? (
								<li key={bar.month}>
									<Button
										aria-pressed={i === on}
										kind={i === on ? "secondary" : "ghost"}
										onClick={() => onPick(bar.span)}
										size="sm"
									>
										{month(`${bar.month}-01`)}{" "}
										<Money
											figure={bar.total ? monthFigure(bar) : undefined}
											missing="noRate"
											value={bar.total}
										/>
									</Button>
								</li>
							) : (
								[]
							),
						)}
					</ul>
				</div>
			)}
		</Section>
	);
}
