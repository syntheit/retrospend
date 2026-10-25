"use client";

import type { Span } from "@retrospend/domain/insights";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { MonthlyBars } from "~/components/charts/monthly-bars";
import { Section } from "~/components/layout/section";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import { useIsMobile } from "~/hooks/use-mobile";
import type { MonthsDTO } from "~/server/services/insights/types";
import { monthFigure, monthTotals } from "./insights-vm";
import { ChartSkeleton, type PartQuery, PartUnavailable } from "./part-states";

const HEIGHT = { desktop: 180, phone: 160 };

/**
 * Month by month: the last six months of the same filters, the month the
 * range ends in highlighted. A bar opens that month in Activity. The drawing
 * is for sight only, so the same targets follow as links (hidden visually)
 * with each month's figure, for keyboards and screen readers.
 */
export function MonthsSection({
	query,
	hrefOf,
}: {
	query: PartQuery<MonthsDTO>;
	hrefOf: (span: Span) => string;
}) {
	const t = useTranslations("insights.months");
	const router = useRouter();
	const phone = useIsMobile();
	const { month } = useRowDates();
	const data = query.data;
	const totals = useMemo(() => (data ? monthTotals(data.months) : []), [data]);
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
						months={totals}
						onSelect={(i) => {
							const bar = data.months[i];
							if (bar) router.push(hrefOf(bar.span));
						}}
					/>
					<ul aria-label={t("list")} className="sr-only">
						{data.months.map((bar) => (
							<li key={bar.month}>
								<Link href={hrefOf(bar.span)}>
									{month(`${bar.month}-01`)}{" "}
									<Money
										figure={bar.total ? monthFigure(bar) : undefined}
										missing="noRate"
										value={bar.total}
									/>
								</Link>
							</li>
						))}
					</ul>
				</div>
			)}
		</Section>
	);
}
