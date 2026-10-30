import type { ReactElement } from "react";
import { ScrollView } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Menu } from "@/ui/Menu";
import type { MenuItem } from "@/ui/types";
import { DEFAULT_VIEW, type InsightsView, PERIODS } from "./view";

export interface ChipChoice {
	id: string;
	label: string;
	/** The identity mark before the label in the menu. */
	lead?: ReactElement;
}

/**
 * The period, Category and Person chips in one row, each the system menu
 * chip as on Activity. The period chip carries Compare to the period before,
 * as the web's range chip does; a chip that is set says what it is set to and
 * turns brand-soft (the period is set once it is not this month, or compared).
 */
export function InsightsToolbar({
	view,
	onChange,
	categories,
	people,
}: {
	view: InsightsView;
	onChange: (next: InsightsView) => void;
	categories: readonly ChipChoice[];
	people: readonly ChipChoice[];
}) {
	const t = useTranslations("mobile.insights");
	const ta = useTranslations("mobile.activity.chip");
	const { space } = useTheme();

	const periodItems: MenuItem[] = [
		...PERIODS.map((period) => ({
			id: period,
			label: t(`period.${period}`),
			onPress: () => onChange({ ...view, period }),
		})),
		// All time has no period before it.
		...(view.period === "all"
			? []
			: [
					{
						id: "compare",
						label: view.compare ? t("compareOff") : t("compareOn"),
						onPress: () => onChange({ ...view, compare: !view.compare }),
					},
				]),
	];
	const periodName = t(`period.${view.period}`);
	const periodLabel =
		view.compare && view.period !== "all"
			? t("compared", { period: periodName })
			: periodName;

	const categoryItems: MenuItem[] = [
		{
			id: "all",
			label: ta("allCategories"),
			onPress: () => onChange({ ...view, categoryId: null }),
		},
		...categories.map((c) => ({
			id: c.id,
			label: c.label,
			lead: c.lead,
			onPress: () => onChange({ ...view, categoryId: c.id }),
		})),
	];
	const personItems: MenuItem[] = [
		{
			id: "all",
			label: ta("everyone"),
			onPress: () => onChange({ ...view, personKey: null }),
		},
		...people.map((p) => ({
			id: p.id,
			label: p.label,
			lead: p.lead,
			onPress: () => onChange({ ...view, personKey: p.id }),
		})),
	];
	const category = categories.find((c) => c.id === view.categoryId);
	const person = people.find((p) => p.id === view.personKey);

	return (
		<ScrollView
			accessibilityLabel={t("filters")}
			contentContainerStyle={{
				alignItems: "center",
				gap: space[2],
				paddingHorizontal: space[4],
				paddingVertical: space[1],
			}}
			horizontal
			showsHorizontalScrollIndicator={false}
		>
			<Menu
				active={view.period !== DEFAULT_VIEW.period || view.compare}
				chip
				items={periodItems}
				label={periodLabel}
			/>
			<Menu
				active={category !== undefined}
				chip
				items={categoryItems}
				label={category ? category.label : ta("category")}
			/>
			<Menu
				active={person !== undefined}
				chip
				items={personItems}
				label={person ? person.label : ta("person")}
			/>
		</ScrollView>
	);
}
