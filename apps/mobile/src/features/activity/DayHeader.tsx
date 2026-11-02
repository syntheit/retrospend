import type { Money } from "@retrospend/domain/money-minor";
import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { dayDate } from "@/lib/days";
import { useTheme } from "@/theme";
import { Text } from "@/ui/Text";

/** "Wed, Oct 21": a day the server named, shown in the phone's language. */
export function useDayLabel() {
	const t = useTranslations("mobile.common");
	const format = useFormatter();
	return (day: string, relative: "today" | "yesterday" | null) => {
		if (relative) return t(relative);
		return format.dateTime(dayDate(day), {
			weekday: "short",
			month: "short",
			day: "numeric",
		});
	};
}

/**
 * The line over a day's rows: its name and what you spent that day, both
 * 13 at medium weight in fg-2, close to its rows.
 */
export function DayHeader({
	label,
	total,
}: {
	label: string;
	total: Money | null;
}) {
	const { color, space } = useTheme();
	const format = useMoneyText();
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "baseline",
				justifyContent: "space-between",
				gap: space[4],
				paddingHorizontal: space[4] + space[1],
				paddingTop: space[4],
				paddingBottom: space[2],
				backgroundColor: color.bg,
			}}
		>
			<Text
				accessibilityRole="header"
				tone="fg2"
				variant="small"
				weight="medium"
			>
				{label}
			</Text>
			{total ? (
				<Text
					numberOfLines={1}
					tabular
					tone="fg2"
					variant="small"
					weight="medium"
				>
					{format(total)}
				</Text>
			) : null}
		</View>
	);
}
