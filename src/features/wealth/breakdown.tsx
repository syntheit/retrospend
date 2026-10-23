"use client";

import { ChartColumn } from "lucide-react";
import { useTranslations } from "next-intl";
import { RankedBars } from "~/components/charts/ranked-bars";
import { Section } from "~/components/layout/section";
import { usePercent } from "~/components/rows/percent";
import { Empty } from "~/components/ui/empty-state";
import type { WealthShare, WealthView } from "./types";

/** The breakdown view: ranked bars by type, by currency and by liquidity. */
export function Breakdown({ view }: { view: WealthView }) {
	const t = useTranslations("wealthPage");
	const percent = usePercent();
	if (!view.breakdown.byType.length)
		return (
			<Empty
				hint={t("breakdown.emptyHint")}
				icon={ChartColumn}
				title={t("breakdown.empty")}
			/>
		);
	const bars = (list: WealthShare[], label: (key: string) => string) => (
		<RankedBars
			items={list.map((s) => ({
				id: s.key,
				label: t("breakdown.item", {
					label: label(s.key),
					share:
						s.share < 100
							? t("breakdown.underOne")
							: percent(s.share, { digits: s.share < 1000 ? 1 : 0 }),
				}),
				value: s.value,
				series: s.series,
			}))}
		/>
	);
	return (
		<div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-8">
			<Section title={t("breakdown.byType")}>
				{bars(view.breakdown.byType, (k) => t(`groups.${k}`))}
			</Section>
			<Section className="mt-0" title={t("breakdown.byCurrency")}>
				{bars(view.breakdown.byCurrency, (k) => k)}
			</Section>
			<Section className="mt-0" title={t("breakdown.byLiquidity")}>
				{bars(view.breakdown.byLiquidity, (k) => t(`breakdown.${k}`))}
			</Section>
		</div>
	);
}
