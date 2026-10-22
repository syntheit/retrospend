"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Line, LineChart, XAxis, YAxis } from "recharts";
import type { MoneyValue } from "~/components/money/format";
import { Money } from "~/components/money/money";
import { ChartContainer, ChartTooltip } from "~/components/ui/chart";
import {
	ChartFrame,
	ChartTip,
	useChartMotion,
	useMoneyText,
} from "./chart-frame";
import { COLOR, LABEL, MARGIN, MOTION, STROKE } from "./spec";

export type PaceSeries = {
	currency: string;
	/** Spent so far this period, cumulative per day, minor units. */
	current: number[];
	/** The last period, cumulative per day, for comparison. */
	previous: number[];
	/** Days in the period (the x axis). */
	days: number;
};

/**
 * Pace line: this period against the last, cumulative. The accent line ends
 * in a dot at today; the last period is a dashed fg-3 line. One question:
 * am I spending faster than last month?
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
	const today = pace.current.length;
	const spent: MoneyValue = {
		minor: pace.current[today - 1] ?? 0,
		currency: pace.currency,
	};
	const before: MoneyValue = {
		minor: pace.previous[today - 1] ?? 0,
		currency: pace.currency,
	};
	return (
		<ChartFrame
			height={height}
			summary={t("pace.summary", {
				day: today,
				spent: text(spent),
				before: text(before),
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
						content={({ active, payload }) =>
							active && payload?.[0] ? (
								<ChartTip label={t("day", { day: payload[0].payload.day })}>
									{payload[0].payload.current != null ? (
										<Money
											value={{
												minor: payload[0].payload.current,
												currency: pace.currency,
											}}
										/>
									) : (
										<Money
											value={{
												minor: payload[0].payload.previous ?? 0,
												currency: pace.currency,
											}}
										/>
									)}
								</ChartTip>
							) : null
						}
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
						dot={(p: { index?: number; cx?: number; cy?: number }) =>
							p.index === today - 1 && p.cx != null && p.cy != null ? (
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
						isAnimationActive={animate}
						stroke={COLOR.accent}
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={STROKE.line}
						type="linear"
					/>
				</LineChart>
			</ChartContainer>
		</ChartFrame>
	);
}
