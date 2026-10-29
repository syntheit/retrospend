import { useState } from "react";
import { type LayoutChangeEvent, Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { barShares, highlightIndex } from "./rows";
import type { InsightsMonths } from "./source";
import type { InsightsWords } from "./useInsightsWords";

/**
 * Month by month (GUIDELINE 9, monthly bars): the last months of the same
 * filters, the month the range ends in in the accent and the others in the
 * accent tint. A month with no rate is a gap, never zero. The totals are the
 * server's; the drawing is for sight, and a screen reader hears each month.
 */
export function MonthBars({
	data,
	rangeEnd,
	words,
}: {
	data: InsightsMonths;
	rangeEnd: string;
	words: InsightsWords;
}) {
	const t = useTranslations("mobile.insights.months");
	const noRate = useTranslations("mobile.money")("noRate");
	const money = useMoneyText();
	const { color, radius, space, type } = useTheme();
	const [width, setWidth] = useState(0);
	const height = space[12] * 3 + space[4];
	const gap = space[3];
	const months = data.months;
	const shares = barShares(months.map((m) => m.total));
	const hi = highlightIndex(months, rangeEnd);
	const barWidth =
		months.length > 0
			? Math.max(0, (width - gap * (months.length - 1)) / months.length)
			: 0;
	const spoken = months
		.map(
			(m) => `${words.monthLong(m.month)} ${m.total ? money(m.total) : noRate}`,
		)
		.join(", ");

	return (
		<View
			accessibilityLabel={t("summary", { list: spoken })}
			accessible
			style={{ paddingHorizontal: space[4] }}
		>
			<View
				onLayout={(e: LayoutChangeEvent) =>
					setWidth(Math.round(e.nativeEvent.layout.width))
				}
				style={{ height }}
			>
				{width > 0 ? (
					<Svg height={height} width={width}>
						{months.map((m, i) => {
							const h = Math.round((shares[i] ?? 0) * height);
							if (!m.total || h <= 0) return null;
							return (
								<Rect
									fill={i === hi ? color.accent : color.accentSoft}
									height={h}
									key={m.month}
									rx={Math.min(radius.ctl / 2, barWidth / 2)}
									width={barWidth}
									x={i * (barWidth + gap)}
									y={height - h}
								/>
							);
						})}
					</Svg>
				) : null}
			</View>
			<View
				importantForAccessibility="no-hide-descendants"
				style={{ flexDirection: "row", gap, paddingTop: space[1] }}
			>
				{months.map((m, i) => (
					<Text
						key={m.month}
						numberOfLines={1}
						style={{
							flex: 1,
							textAlign: "center",
							color: i === hi ? color.fg : color.fg2,
							fontSize: type.meta.size,
							fontWeight: i === hi ? "500" : "400",
						}}
					>
						{words.monthShort(m.month)}
					</Text>
				))}
			</View>
			<Text
				importantForAccessibility="no"
				style={{
					color: color.fg3,
					fontSize: type.meta.size,
					paddingTop: space[2],
				}}
			>
				{t("caption")}
			</Text>
		</View>
	);
}
