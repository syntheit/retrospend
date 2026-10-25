import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { columnHeights, downsample, endsOf, indexAt } from "./series";
import type { SeriesPoint } from "./source";

/** A column about this wide reads as a smooth area; more points than columns are thinned. */
const COLUMN_WIDTH = 3;
const CAP = 2;

/**
 * Net worth over a range as an area of thin columns, drawn from the server's
 * daily series. A finger dragged across it reports the day under it (the page
 * shows that day's value in the hero); lifting puts today back. No chart
 * library: the shape is only views, so it looks the same on iPhone, iPad and
 * Android and costs no dependency. For a screen reader the chart is one
 * adjustable element: swipe up or down to move from day to day.
 */
export function ScrubChart({
	points,
	height,
	label,
	onScrub,
}: {
	points: readonly SeriesPoint[];
	height: number;
	/** What the chart is, said first: "Net worth, last 3 months". */
	label: string;
	/** The day under the finger, or null when it lifts. */
	onScrub: (point: SeriesPoint | null) => void;
}) {
	const t = useTranslations("mobile.wealth.chart");
	const format = useFormatter();
	const money = useMoneyText();
	const { color, space, type } = useTheme();
	const [width, setWidth] = useState(0);
	const [index, setIndex] = useState<number | null>(null);

	const columns = useMemo(
		() =>
			downsample(points, Math.max(1, Math.floor(width / COLUMN_WIDTH))),
		[points, width],
	);
	const heights = useMemo(
		() =>
			columnHeights(
				columns.map((p) => p.value),
				height,
				CAP * 2,
			),
		[columns, height],
	);
	const { first, last } = endsOf(columns);

	const day = (date: string) =>
		format.dateTime(new Date(`${date}T12:00:00Z`), {
			month: "short",
			day: "numeric",
			timeZone: "UTC",
		});
	const select = (next: number | null) => {
		setIndex(next);
		onScrub(next === null ? null : (columns[next] ?? null));
	};

	// Horizontal drags scrub; a vertical drag falls through to the page scroll.
	const pan = Gesture.Pan()
		.runOnJS(true)
		.activeOffsetX([-6, 6])
		.failOffsetY([-12, 12])
		.onStart((e) => select(indexAt(e.x, width, columns.length)))
		.onUpdate((e) => select(indexAt(e.x, width, columns.length)))
		.onFinalize(() => select(null));

	const picked = index === null ? null : (columns[index] ?? null);
	const spoken =
		first?.value && last?.value
			? t("summary", {
					label,
					from: money(first.value),
					fromDate: day(first.date),
					to: money(last.value),
					toDate: day(last.date),
				})
			: label;
	const cursor = index === null || width === 0 ? null : (index + 0.5) * (width / columns.length);

	const move = (delta: number) => {
		const from = index ?? columns.length - 1;
		select(Math.max(0, Math.min(columns.length - 1, from + delta)));
	};

	return (
		<View style={{ gap: space[1] }}>
			<GestureDetector gesture={pan}>
				<View
					accessibilityActions={[
						{ name: "increment", label: t("later") },
						{ name: "decrement", label: t("earlier") },
					]}
					accessibilityLabel={spoken}
					accessibilityRole="adjustable"
					accessibilityValue={{
						text:
							picked?.value
								? t("pick", { date: day(picked.date), amount: money(picked.value) })
								: undefined,
					}}
					accessible
					onAccessibilityAction={(event) => {
						if (event.nativeEvent.actionName === "increment") move(1);
						if (event.nativeEvent.actionName === "decrement") move(-1);
					}}
					onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
					style={{
						height,
						flexDirection: "row",
						alignItems: "flex-end",
					}}
				>
					{columns.map((column, i) => {
						const h = heights[i];
						return (
							<View
								key={column.date}
								style={{
									flex: 1,
									height: h ?? 0,
									backgroundColor: h === null ? undefined : color.accentSoft,
									borderTopWidth: h === null ? 0 : CAP,
									borderTopColor: i === index ? color.fg : color.accent,
								}}
							/>
						);
					})}
					{cursor !== null ? (
						<View
							pointerEvents="none"
							style={{
								position: "absolute",
								left: cursor,
								top: 0,
								bottom: 0,
								width: 1,
								backgroundColor: color.fg,
							}}
						/>
					) : null}
				</View>
			</GestureDetector>
			{first && last ? (
				<View
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
					style={{ flexDirection: "row", justifyContent: "space-between" }}
				>
					<Text style={{ color: color.fg2, fontSize: type.small.size }}>
						{day(first.date)}
					</Text>
					<Text style={{ color: color.fg2, fontSize: type.small.size }}>
						{day(last.date)}
					</Text>
				</View>
			) : null}
		</View>
	);
}
