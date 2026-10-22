"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Area, AreaChart, ReferenceDot, XAxis, YAxis } from "recharts";
import type { MoneyValue } from "~/components/money/format";
import { useRowDates } from "~/components/rows/dates";
import { ChartContainer, ChartTooltip } from "~/components/ui/chart";
import {
	ChartEmpty,
	ChartFrame,
	isEmptySeries,
	useChartMotion,
	useMoneyText,
} from "./chart-frame";
import { COLOR, edgeTicks, LABEL, MARGIN, MOTION, STROKE } from "./spec";

export type AreaPoint = {
	/** ISO date of the point. */
	date: string;
	/** The value that day; null is a gap (no data), never zero. */
	value: MoneyValue | null;
};

/**
 * The point under a scrub: the chart's active index, or null when the
 * pointer or finger is off the data. Recharts sends the index as a number
 * or a string.
 */
export function scrubPoint(
	points: AreaPoint[],
	index: unknown,
): AreaPoint | null {
	if (index == null || index === "") return null;
	const i = Number(index);
	return Number.isInteger(i) ? (points[i] ?? null) : null;
}

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
	const values = data.flatMap((d) => (d.value == null ? [] : [d.value]));
	if (isEmptySeries(values)) return <ChartEmpty height={height} />;
	const ticks = edgeTicks(data.map((d) => d.date));
	const last = points[points.length - 1];
	const first = points[0];
	const low = Math.min(...values);
	const high = Math.max(...values);
	const pad = (high - low) * 0.12 || 1;
	const scrub = (state: { activeTooltipIndex?: unknown }) =>
		onScrub?.(scrubPoint(points, state.activeTooltipIndex));
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
					onMouseMove={scrub}
					onTouchEnd={() => onScrub?.(null)}
					onTouchMove={scrub}
					onTouchStart={scrub}
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
						dot={false}
						fill={COLOR.area}
						fillOpacity={1}
						isAnimationActive={animate}
						stroke={COLOR.accent}
						strokeWidth={STROKE.line}
						type="linear"
					/>
					{last?.value && (
						<ReferenceDot
							fill={COLOR.accent}
							r={STROKE.dot}
							stroke={COLOR.ring}
							strokeWidth={STROKE.dotRing}
							x={last.date}
							y={last.value.minor}
						/>
					)}
				</AreaChart>
			</ChartContainer>
		</ChartFrame>
	);
}
