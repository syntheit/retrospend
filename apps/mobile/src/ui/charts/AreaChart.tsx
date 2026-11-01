import { useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import type { Money } from "@/lib/money";
import { useTheme } from "@/theme";
import { TEXT_SCALE_CAP } from "../Text";
import { areaShape, nearestIndex, type Plot } from "./area";
import {
	AXIS,
	chartColors,
	edgeTicks,
	MARGIN,
	OPACITY,
	SCRUB,
	STROKE,
} from "./chartSpec";

export interface AreaPoint {
	/** ISO date of the point (YYYY-MM-DD). */
	date: string;
	/** The server's value that day; null is a gap (no rate, no data), never zero. */
	value: Money | null;
}

let haptics: Promise<typeof import("expo-haptics") | null> | null = null;

/**
 * One light tick when a scrub starts. Loaded on first use, and silent when
 * the native module is missing (an older dev build), so a chart never fails
 * over a vibration.
 */
function tick() {
	haptics ??= import("expo-haptics").catch(() => null);
	haptics.then((module) => module?.selectionAsync()).catch(() => undefined);
}

/**
 * A value over time (GUIDELINE §9, the web's net worth area): a 2pt accent
 * line over the accent at 16%, an axis, an end dot with a surface ring and
 * three date labels at 12 fg-3. Drag sideways (or press and hold, then drag) to scrub: a
 * crosshair in line-strong follows the finger, the dot moves to that day and
 * `onScrub` gets the point so the page's hero can show it; lifting the finger
 * sends null. A sideways drag scrubs at once; a vertical one scrolls the page. The figures are the server's: the chart only places them.
 * Charts draw in place, with no motion, so reduced motion needs nothing.
 * For a screen reader the chart is one adjustable element: swipe up or down
 * to move from day to day. With no known value it draws nothing.
 */
export function AreaChart({
	points,
	label,
	height = 220,
	dates = "day",
	onScrub,
}: {
	points: readonly AreaPoint[];
	/** What the chart is, said first: "Net worth, last 3 months". */
	label: string;
	/** Full height, the date labels included. */
	height?: number;
	/** How the date labels read: "Oct 21" or "Oct". */
	dates?: "day" | "month";
	onScrub?: (point: AreaPoint | null) => void;
}) {
	const t = useTranslations("mobile.charts");
	const format = useFormatter();
	const money = useMoneyText();
	const { color, space, type } = useTheme();
	const tone = chartColors(color);
	const [width, setWidth] = useState(0);
	const [index, setIndex] = useState<number | null>(null);
	const active = useRef<number | null>(null);

	const plot: Plot = useMemo(
		() => ({ width, height: height - AXIS.height, margin: MARGIN.area }),
		[width, height],
	);
	const shape = useMemo(
		() =>
			areaShape(
				points.map((p) => p.value?.minor ?? null),
				plot,
			),
		[points, plot],
	);
	const known = points.filter((p) => p.value !== null);
	if (known.length === 0) return null;

	const day = (date: string) =>
		format.dateTime(new Date(`${date}T12:00:00Z`), {
			month: "short",
			day: dates === "day" ? "numeric" : undefined,
			timeZone: "UTC",
		});
	const amount = (point: AreaPoint) =>
		point.value ? money(point.value) : t("noData");

	const select = (next: number | null) => {
		if (next === active.current) return;
		active.current = next;
		setIndex(next);
		onScrub?.(next === null ? null : (points[next] ?? null));
	};
	const at = (x: number) => nearestIndex(x, points.length, plot);

	// Drag sideways at once, or hold and then drag: a vertical swipe falls
	// through to the page scroll.
	const scrub = (gesture: ReturnType<typeof Gesture.Pan>) =>
		gesture
			.runOnJS(true)
			.onStart((e) => {
				tick();
				select(at(e.x));
			})
			.onUpdate((e) => select(at(e.x)))
			.onFinalize(() => select(null));
	const pan = Gesture.Race(
		scrub(
			Gesture.Pan()
				.activeOffsetX([-SCRUB.startPx, SCRUB.startPx])
				.failOffsetY([-SCRUB.failPx, SCRUB.failPx]),
		),
		scrub(Gesture.Pan().activateAfterLongPress(SCRUB.holdMs)),
	);

	const move = (delta: number) => {
		const from = active.current ?? points.length - 1;
		select(Math.max(0, Math.min(points.length - 1, from + delta)));
	};

	const first = known[0];
	const last = known[known.length - 1];
	const spoken =
		first && last
			? t("summary", {
					label,
					from: amount(first),
					fromDate: day(first.date),
					to: amount(last),
					toDate: day(last.date),
				})
			: label;
	const picked = index === null ? null : (points[index] ?? null);
	const cross = index === null ? null : (shape.xs[index] ?? null);
	const pickedY = index === null ? null : (shape.ys[index] ?? null);
	const dot =
		cross !== null && pickedY !== null ? { x: cross, y: pickedY } : shape.end;
	const ticks = edgeTicks(points);
	const axisY = shape.base - STROKE.axis / 2;

	return (
		<View style={{ height }}>
			<GestureDetector gesture={pan}>
				<View
					accessibilityActions={[
						{ name: "increment", label: t("later") },
						{ name: "decrement", label: t("earlier") },
					]}
					accessibilityLabel={spoken}
					accessibilityRole="adjustable"
					accessibilityValue={{
						text: picked
							? t("pick", { date: day(picked.date), amount: amount(picked) })
							: undefined,
					}}
					accessible
					onAccessibilityAction={(event) => {
						if (event.nativeEvent.actionName === "increment") move(1);
						if (event.nativeEvent.actionName === "decrement") move(-1);
					}}
					onLayout={(event) =>
						setWidth(Math.round(event.nativeEvent.layout.width))
					}
					style={{ height: plot.height }}
				>
					{width > 0 ? (
						<Svg height={plot.height} width={width}>
							<Path
								d={shape.area}
								fill={tone.area}
								fillOpacity={OPACITY.area}
							/>
							<Line
								stroke={tone.axis}
								strokeWidth={STROKE.axis}
								x1={0}
								x2={width}
								y1={axisY}
								y2={axisY}
							/>
							<Path
								d={shape.line}
								fill="none"
								stroke={tone.accent}
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={STROKE.line}
							/>
							{cross !== null ? (
								<Line
									stroke={tone.cross}
									strokeWidth={STROKE.cross}
									x1={cross}
									x2={cross}
									y1={plot.margin.top}
									y2={shape.base}
								/>
							) : null}
							{dot ? (
								<Circle
									cx={dot.x}
									cy={dot.y}
									fill={tone.accent}
									r={STROKE.dot}
									stroke={tone.ring}
									strokeWidth={STROKE.dotRing}
								/>
							) : null}
						</Svg>
					) : null}
				</View>
			</GestureDetector>
			<View
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
				style={{
					height: AXIS.height,
					flexDirection: "row",
					alignItems: "flex-end",
					justifyContent: ticks.length > 1 ? "space-between" : "center",
					gap: space[2],
				}}
			>
				{ticks.map((point) => (
					<Text
						key={point.date}
						// The axis row has a fixed height: its labels stop growing at the chrome cap.
						maxFontSizeMultiplier={TEXT_SCALE_CAP.chrome}
						numberOfLines={1}
						style={{ color: tone.label, fontSize: type.meta.size }}
					>
						{day(point.date)}
					</Text>
				))}
			</View>
		</View>
	);
}
