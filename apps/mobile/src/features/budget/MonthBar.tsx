import { Pressable, Text, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Menu } from "@/ui/Menu";
import {
	addMonths,
	canStep,
	type MonthBounds,
	monthChoices,
	monthDate,
	monthKind,
} from "./months";

/**
 * The month switcher: back opens a closed month read-only, forward opens
 * the plan for next month. The month's name opens the list of months.
 */
export function MonthBar({
	month,
	bounds,
	onChange,
}: {
	month: number;
	bounds: MonthBounds;
	onChange: (month: number) => void;
}) {
	const t = useTranslations("mobile.budget.month");
	const format = useFormatter();
	const { color, size, space, type } = useTheme();

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

	const step = (delta: -1 | 1, text: string, glyph: string) => {
		const enabled = canStep(month, delta, bounds);
		return (
			<Pressable
				accessibilityLabel={text}
				accessibilityRole="button"
				accessibilityState={{ disabled: !enabled }}
				disabled={!enabled}
				onPress={() => onChange(addMonths(month, delta))}
				style={{
					width: size.touchMin.phone,
					height: size.touchMin.phone,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<Text
					style={{
						color: enabled ? color.brand : color.fg3,
						fontSize: type.title.size,
						fontWeight: "500",
					}}
				>
					{glyph}
				</Text>
			</Pressable>
		);
	};

	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				justifyContent: "space-between",
				paddingHorizontal: space[2],
			}}
		>
			{step(-1, t("previous"), "‹")}
			<Menu
				accessibilityLabel={t("pick")}
				items={monthChoices(bounds).map((key) => ({
					id: String(key),
					label: label(key),
					onPress: () => onChange(key),
				}))}
				label={label(month)}
			/>
			{step(1, t("next"), "›")}
		</View>
	);
}
