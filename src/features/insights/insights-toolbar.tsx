"use client";

import { useTranslations } from "next-intl";
import { Toolbar } from "~/components/layout/toolbar";
import { DateRange } from "~/components/pickers/date-range";
import { FilterChips } from "~/components/ui/chip";
import { useDimItems } from "~/features/activity/activity-toolbar";
import { DimChip } from "~/features/activity/dim-chip";
import type { InsightsDim, InsightsView } from "./filter";

/**
 * The range and the Category, Person and Project chips, in one row. The chips
 * are Activity's (multi-select with identity, the list stays open), and the
 * range chip carries Compare to previous period.
 */
export function InsightsToolbar({
	view,
	setView,
	today,
}: {
	view: InsightsView;
	setView: (v: InsightsView) => void;
	today: string;
}) {
	const t = useTranslations("insights.toolbar");
	const tf = useTranslations("activity.filters");
	const items = useDimItems();
	const chip = (dim: InsightsDim) => (
		<DimChip
			items={items[dim]}
			label={tf(`dim.${dim}`)}
			onChange={(value) => setView({ ...view, [dim]: value })}
			value={view[dim]}
		/>
	);
	return (
		<Toolbar label={t("label")}>
			<FilterChips label={t("label")}>
				<DateRange
					compare={view.compare}
					onChange={(r) =>
						setView({
							...view,
							compare: r.compare,
							range: { from: r.from, to: r.to },
						})
					}
					today={today}
					value={view.range}
				/>
				{chip("cats")}
				{chip("people")}
				{chip("projects")}
			</FilterChips>
		</Toolbar>
	);
}
