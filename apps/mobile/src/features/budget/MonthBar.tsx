import type { ReactNode } from "react";
import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Menu } from "@/ui/Menu";
import { type MonthBounds, monthChoices, monthDate, monthKind } from "./months";

/**
 * The month on screen, "October 2026", at the start of the row. It is a menu
 * of the months, not a pair of steppers: a closed one reads, the next one is
 * the plan. `trailing` is the page's own menu at the other end of the row.
 */
export function MonthBar({
	month,
	bounds,
	onChange,
	trailing,
}: {
	month: number;
	bounds: MonthBounds;
	onChange: (month: number) => void;
	trailing?: ReactNode;
}) {
	const t = useTranslations("mobile.budget.month");
	const format = useFormatter();
	const { size, space } = useTheme();

	const name = (key: number) =>
		format.dateTime(monthDate(key), {
			month: "long",
			year: "numeric",
			timeZone: "UTC",
		});
	const label = (key: number) => {
		const kind = monthKind(key, bounds);
		return kind === "closed"
			? t("closedItem", { month: name(key) })
			: kind === "next"
				? t("planItem", { month: name(key) })
				: name(key);
	};

	return (
		<View
			style={{
				minHeight: size.touchMin.phone,
				flexDirection: "row",
				alignItems: "center",
				justifyContent: "space-between",
				gap: space[3],
				paddingHorizontal: space[4],
			}}
		>
			<Menu
				accessibilityLabel={t("pick")}
				items={monthChoices(bounds).map((key) => ({
					id: String(key),
					label: label(key),
					onPress: () => onChange(key),
				}))}
				label={label(month)}
			/>
			{trailing}
		</View>
	);
}
