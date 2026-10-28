import { useState } from "react";
import { type LayoutChangeEvent, Text, View } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useTheme } from "@/theme";
import { type PaceLines, paceLines, paceShape } from "./pace";
import type { Glance } from "./source";

/** "October": a month the server named by its first day, in the phone's language. */
function useMonthName() {
	const format = useFormatter();
	return (day: string) => {
		const [y, m] = day.split("-").map(Number) as [number, number];
		return format.dateTime(new Date(y, m - 1, 15), { month: "long" });
	};
}

function Swatch({ dashed, color }: { dashed?: boolean; color: string }) {
	const { space } = useTheme();
	const width = space[4];
	return (
		<Svg height={space[2]} width={width}>
			<Line
				stroke={color}
				strokeDasharray={dashed ? `${space[1] / 2} ${space[1] / 2}` : undefined}
				strokeWidth={space[1] / 2}
				x1={0}
				x2={width}
				y1={space[1]}
				y2={space[1]}
			/>
		</Svg>
	);
}

/**
 * This month against last, cumulative per day: the accent line ends in one
 * dot at today, last month is a dashed gray line (GUIDELINE 9). The totals
 * are the server's (glance.pace); nothing is added here. No spending yet
 * says so in words, never a flat line.
 */
export function PaceChart({ glance }: { glance: Glance }) {
	const t = useTranslations("mobile.home.pace");
	const money = useMoneyText();
	const monthName = useMonthName();
	const { color, size, space, type } = useTheme();
	const [width, setWidth] = useState(0);
	const days = glance.period.days;
	const lines: PaceLines = paceLines({
		current: glance.pace.this,
		previous: glance.pace.last,
	});
	const drawn = lines.current.length > 0 || lines.previous.length > 0;
	const height = space[12] + space[8];
	const inset = space[2];

	if (!drawn) {
		return (
			<Text
				style={{
					color: color.fg2,
					fontSize: type.body.size,
					paddingHorizontal: space[4],
					paddingBottom: space[2],
				}}
			>
				{t("empty")}
			</Text>
		);
	}

	const today = lines.current.length;
	const at = (values: readonly number[], day: number) => {
		const minor = values[day - 1];
		return minor === undefined
			? t("noData")
			: money({ minor, currency: glance.home });
	};
	const summary = t("summary", {
		day: today,
		spent: at(lines.current, today),
		before: at(lines.previous, today),
	});
	const shape = width > 0 ? paceShape(lines, days, width, height, inset) : null;
	const thisName = monthName(glance.period.from);
	const lastName = monthName(glance.lastPeriod.from);

	return (
		<View
			accessibilityLabel={summary}
			accessible
			style={{ paddingHorizontal: space[4], paddingBottom: space[2] }}
		>
			<View
				onLayout={(e: LayoutChangeEvent) =>
					setWidth(Math.round(e.nativeEvent.layout.width))
				}
				style={{ height }}
			>
				{shape ? (
					<Svg height={height} width={width}>
						<Path
							d={shape.previous}
							fill="none"
							stroke={color.fg3}
							strokeDasharray={`${space[1]} ${space[1]}`}
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={size.icon.stroke}
						/>
						<Path
							d={shape.current}
							fill="none"
							stroke={color.accent}
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={space[1] / 2}
						/>
						{shape.end ? (
							<Circle
								cx={shape.end.x}
								cy={shape.end.y}
								fill={color.accent}
								r={space[1] + space[1] / 4}
								stroke={color.bg}
								strokeWidth={space[1] / 2}
							/>
						) : null}
					</Svg>
				) : null}
			</View>
			<View
				importantForAccessibility="no-hide-descendants"
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: space[4],
					paddingTop: space[1],
				}}
			>
				<View
					style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}
				>
					<Swatch color={color.accent} />
					<Text style={{ color: color.fg2, fontSize: type.meta.size }}>
						{thisName}
					</Text>
				</View>
				<View
					style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}
				>
					<Swatch color={color.fg3} dashed />
					<Text style={{ color: color.fg2, fontSize: type.meta.size }}>
						{lastName}
					</Text>
				</View>
			</View>
		</View>
	);
}
