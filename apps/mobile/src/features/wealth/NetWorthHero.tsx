import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { Segmented } from "@/ui/Segmented";
import { RANGES, sliceRange, type WealthRange } from "./series";
import { ScrubChart } from "./ScrubChart";
import type { NetWorth, SeriesPoint } from "./source";

const CHART_HEIGHT = 160;

/**
 * Net worth: the one hero of Wealth. The number is the server's (null when a
 * rate is missing, which reads as words, never 0), the change over 30 days is
 * the server's, and the chart is its daily series. Dragging across the chart
 * swaps the number and the line under it for that day's.
 */
export function NetWorthHero({ netWorth }: { netWorth: NetWorth }) {
	const t = useTranslations("mobile.wealth");
	const tm = useTranslations("mobile.money");
	const format = useFormatter();
	const money = useMoneyText();
	const { color, space, type } = useTheme();
	const [range, setRange] = useState<WealthRange>("3M");
	const [scrub, setScrub] = useState<SeriesPoint | null>(null);
	const points = useMemo(
		() => sliceRange(netWorth.series, range),
		[netWorth.series, range],
	);

	const shown = scrub ? scrub.value : netWorth.netWorth;
	const change = netWorth.change;
	const line = scrub
		? format.dateTime(new Date(`${scrub.date}T12:00:00Z`), {
				dateStyle: "medium",
				timeZone: "UTC",
			})
		: change
			? t("change", {
					amount: money(change.total, { sign: "exceptZero" }),
					days: change.days,
				})
			: null;
	const amount = shown ? money(shown) : tm("noRate");

	return (
		<View style={{ gap: space[3], padding: space[4] }}>
			<View
				accessible
				accessibilityLabel={[t("netWorth"), amount, line]
					.filter(Boolean)
					.join(", ")}
				accessibilityLiveRegion="polite"
				style={{ gap: space[1] }}
			>
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{t("netWorth")}
				</Text>
				<Text
					adjustsFontSizeToFit
					numberOfLines={1}
					style={{
						color: color.fg,
						fontSize: type.hero.size,
						fontVariant: ["tabular-nums"],
						fontWeight: "600",
					}}
				>
					{amount}
				</Text>
				<Text style={{ color: color.fg2, fontSize: type.body.size, minHeight: type.body.size * type.body.lineHeight }}>
					{line ?? " "}
				</Text>
			</View>
			{netWorth.series.length > 1 ? (
				<>
					<View style={{ paddingVertical: space[1] }}>
						<Segmented
							accessibilityLabel={t("range")}
							onChange={(next) => {
								setScrub(null);
								setRange(next);
							}}
							options={RANGES.map((value) => ({
								value,
								label: t(`ranges.${value}`),
							}))}
							value={range}
						/>
					</View>
					<ScrubChart
						height={CHART_HEIGHT}
						label={t("chart.label", { range: t(`ranges.${range}`) })}
						onScrub={setScrub}
						points={points}
					/>
				</>
			) : null}
		</View>
	);
}
