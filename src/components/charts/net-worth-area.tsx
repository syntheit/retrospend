"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Area, AreaChart, XAxis, YAxis } from "recharts";
import type { MoneyValue } from "~/components/money/format";
import { useRowDates } from "~/components/rows/dates";
import { ChartContainer, ChartTooltip } from "~/components/ui/chart";
import { ChartFrame, useChartMotion, useMoneyText } from "./chart-frame";
import { COLOR, edgeTicks, LABEL, MARGIN, MOTION, STROKE } from "./spec";

export type AreaPoint = {
	/** ISO date of the point. */
	date: string;
	/** The value that day; null is a gap (no data), never zero. */
	value: MoneyValue | null;
};

/**
 * Area with scrub: net worth over time, accent line over a soft fill, a dot
 * on the latest point. Moving the pointer (or a held finger) across it scrubs:
 * `onScrub` gets the point under it so the page's hero can show that day,
 * and null when the scrub ends, so the hero returns to today.
 */
export function NetWorthArea({
	points,
	currency,
	height = 200,
	label = "month",
	onScrub,
}: {
	points: AreaPoint[];
	currency: string;
	height?: number;
	/** How the edge labels read: by month ("Oct") or by day ("Oct 21"). */
	label?: "month" | "day";
	onScrub?: (point: AreaPoint | null) => void;
}) {
	const t = useTranslations("charts");
	const animate = useChartMotion();
	const text = useMoneyText();
	const { monthShort, short } = useRowDates();
	const fmt = label === "month" ? monthShort : short;
	const data = useMemo(
		() =>
			points.map((p) => ({
				date: p.date,
				value: p.value?.minor ?? null,
			})),
		[points],
	);
	const ticks = edgeTicks(data.map((d) => d.date));
	const last = points[points.length - 1];
	const first = points[0];
	const values = data.flatMap((d) => (d.value == null ? [] : [d.value]));
	const low = Math.min(...values);
	const high = Math.max(...values);
	const pad = (high - low) * 0.12 || 1;
	return (
		<ChartFrame
			height={height}
			summary={t("area.summary", {
				from: first ? fmt(first.date) : "",
				start: first?.value ? text(first.value) : t("noData"),
				to: last ? fmt(last.date) : "",
				end: last?.value ? text(last.value) : t("noData"),
			})}
		>
			<ChartContainer
				className="aspect-auto size-full touch-pan-y"
				config={{ value: { label: t("area.label"), color: COLOR.accent } }}
			>
				<AreaChart
					data={data}
					margin={MARGIN.area}
					onMouseLeave={() => onScrub?.(null)}
					onMouseMove={(state) => {
						const i = Number(state.activeTooltipIndex);
						onScrub?.(Number.isInteger(i) ? (points[i] ?? null) : null);
					}}
					onTouchEnd={() => onScrub?.(null)}
				>
					<XAxis
						axisLine={{ stroke: COLOR.axis }}
						dataKey="date"
						height={22}
						interval="preserveStartEnd"
						tick={LABEL}
						tickFormatter={fmt}
						tickLine={false}
						ticks={ticks}
					/>
					<YAxis domain={[low - pad, high + pad]} hide type="number" />
					<ChartTooltip content={() => null} cursor={{ stroke: COLOR.axis }} />
					<Area
						activeDot={{
							r: STROKE.dot,
							fill: COLOR.accent,
							stroke: COLOR.ring,
							strokeWidth: STROKE.dotRing,
						}}
						animationDuration={MOTION.duration}
						connectNulls={false}
						dataKey="value"
						dot={(p: { index?: number; cx?: number; cy?: number }) =>
							p.index === data.length - 1 && p.cx != null && p.cy != null ? (
								<circle
									cx={p.cx}
									cy={p.cy}
									fill={COLOR.accent}
									key="end"
									r={STROKE.dot}
									stroke={COLOR.ring}
									strokeWidth={STROKE.dotRing}
								/>
							) : (
								<g key={`d${p.index}`} />
							)
						}
						fill={COLOR.area}
						fillOpacity={1}
						isAnimationActive={animate}
						stroke={COLOR.accent}
						strokeWidth={STROKE.line}
						type="linear"
					/>
				</AreaChart>
			</ChartContainer>
		</ChartFrame>
	);
}
