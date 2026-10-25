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
import { cn } from "~/lib/cn";
import type { MonthsDTO } from "~/server/services/insights/types";
import { monthFigure, monthTotals } from "./insights-vm";
import { ChartSkeleton, type PartQuery, PartUnavailable } from "./part-states";
import { FIGURE_LINK } from "./period-was";

const HEIGHT = { desktop: 180, phone: 160 };

/**
 * Month by month: the last six months of the same filters, the month the
 * range ends in highlighted. A bar opens that month in Activity. The drawing
 * is for sight only, so the same targets follow as links (hidden until one has focus)
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
					<p className="text-fg-3 text-meta mt-2">{t("caption")}</p>
					<ul
						aria-label={t("list")}
						className="sr-only focus-within:not-sr-only focus-within:mt-2 focus-within:flex focus-within:flex-wrap focus-within:gap-x-4 focus-within:gap-y-1"
					>
						{data.months.map((bar) => (
							<li key={bar.month}>
								<Link
									className={cn(FIGURE_LINK, "text-small text-fg-2")}
									href={hrefOf(bar.span)}
								>
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
