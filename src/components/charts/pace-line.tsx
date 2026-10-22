"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Line, LineChart, ReferenceDot, XAxis, YAxis } from "recharts";
import { Money } from "~/components/money/money";
import { ChartContainer, ChartTooltip } from "~/components/ui/chart";
import {
	ChartEmpty,
	ChartFrame,
	ChartTip,
	isEmptySeries,
	useChartMotion,
	useMoneyText,
} from "./chart-frame";
import { COLOR, LABEL, MARGIN, MOTION, STROKE } from "./spec";

export type PaceSeries = {
	currency: string;
	/** Spent so far this period, cumulative per day, minor units; null is a gap. */
	current: (number | null)[];
	/** The last period, cumulative per day, for comparison. */
	previous: (number | null)[];
	/** Days in the period (the x axis). */
	days: number;
};

/**
 * Pace line: this period against the last, cumulative. The accent line ends
 * in one dot at today; the last period is a dashed fg-3 line. One question:
 * am I spending faster than last month? No data: says so, never a flat zero.
 */
export function PaceLine({
	pace,
	height = 72,
	axis = false,
	currentLabel,
	previousLabel,
}: {
	pace: PaceSeries;
	height?: number;
	/** Day labels (1 and the last day) under the baseline. */
	axis?: boolean;
	/** Series names for the tooltip ("October", "Last month"). */
	currentLabel: string;
	previousLabel: string;
}) {
	const t = useTranslations("charts");
	const animate = useChartMotion();
	const text = useMoneyText();
	const data = useMemo(
		() =>
			Array.from({ length: pace.days }, (_, i) => ({
				day: i + 1,
				current: pace.current[i] ?? null,
				previous: pace.previous[i] ?? null,
			})),
		[pace],
	);
	if (isEmptySeries([...pace.current, ...pace.previous]))
		return <ChartEmpty height={height} />;
	const today = pace.current.length;
	const end = pace.current[today - 1] ?? null;
	const before = pace.previous[today - 1] ?? null;
	const money = (minor: number | null) =>
		minor == null ? t("noData") : text({ minor, currency: pace.currency });
	return (
		<ChartFrame
			height={height}
			summary={t("pace.summary", {
				day: today,
				spent: money(end),
				before: money(before),
			})}
		>
			<ChartContainer
				className="aspect-auto size-full"
				config={{
					current: { label: currentLabel, color: COLOR.accent },
					previous: { label: previousLabel, color: COLOR.previous },
				}}
			>
				<LineChart data={data} margin={MARGIN.pace}>
					<XAxis
						axisLine={{ stroke: COLOR.axis }}
						dataKey="day"
						height={axis ? 20 : 1}
						interval="preserveStartEnd"
						tick={axis ? LABEL : false}
						tickLine={false}
						ticks={axis ? [1, pace.days] : []}
					/>
					<YAxis domain={[0, (max: number) => max * 1.04]} hide type="number" />
					<ChartTooltip
						content={({ active, payload }) => {
							const p = payload?.[0]?.payload;
							if (!active || !p) return null;
							const minor = p.current ?? p.previous;
							return minor == null ? null : (
								<ChartTip label={t("day", { day: p.day })}>
									<Money value={{ minor, currency: pace.currency }} />
								</ChartTip>
							);
						}}
						cursor={{ stroke: COLOR.axis }}
					/>
					<Line
						animationDuration={MOTION.duration}
						dataKey="previous"
						dot={false}
						isAnimationActive={animate}
						stroke={COLOR.previous}
						strokeDasharray={STROKE.previousDash}
						strokeWidth={STROKE.previous}
						type="linear"
					/>
					<Line
						activeDot={{ r: STROKE.dot - 1, fill: COLOR.accent }}
						animationDuration={MOTION.duration}
						connectNulls={false}
						dataKey="current"
						dot={false}
						isAnimationActive={animate}
						stroke={COLOR.accent}
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={STROKE.line}
						type="linear"
					/>
					{end != null && (
						<ReferenceDot
							fill={COLOR.accent}
							r={STROKE.dot}
							stroke={COLOR.ring}
							strokeWidth={STROKE.dotRing}
							x={today}
							y={end}
						/>
					)}
				</LineChart>
			</ChartContainer>
		</ChartFrame>
	);
}
