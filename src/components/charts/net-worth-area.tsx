"use client";

import { useTranslations } from "next-intl";
import { type KeyboardEvent, useMemo, useState } from "react";
import {
	Area,
	AreaChart,
	ReferenceDot,
	ReferenceLine,
	XAxis,
	YAxis,
} from "recharts";
import type { MoneyValue } from "~/components/money/format";
import { useRowDates } from "~/components/rows/dates";
import { ChartContainer } from "~/components/ui/chart";
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
 * The next point with a value from `from` in a direction (a gap is skipped,
 * never read as zero); stays put at either end.
 */
export function stepScrub(
	points: AreaPoint[],
	from: number | null,
	delta: number,
): number | null {
	const dir = delta < 0 ? -1 : 1;
	let i = from ?? (dir < 0 ? points.length : -1);
	for (let left = Math.abs(delta); left > 0; left--) {
		let j = i + dir;
		while (points[j] && points[j]?.value == null) j += dir;
		if (!points[j]) break;
		i = j;
	}
	return i >= 0 && i < points.length ? i : from;
}

/**
 * Area with scrub: net worth over time, accent line over a soft fill, a dot
 * on the latest point. Moving the pointer (or a held finger) across it scrubs:
 * `onScrub` gets the point under it so the page's hero can show that day,
 * and null when the scrub ends, so the hero returns to today. The keyboard
 * scrubs too: the chart is a slider, the arrow keys step a day (Page keys a
 * week, Home and End the ends) and Escape or leaving it ends the scrub.
 */
export function NetWorthArea({
	points,
	currency,
	height = 200,
	label = "month",
	onScrub,
	name,
	moneyFormat,
	summaryText,
}: {
	points: AreaPoint[];
	currency: string;
	height?: number;
	/** How the edge labels read: by month ("Oct") or by day ("Oct 21"). */
	label?: "month" | "day";
	onScrub?: (point: AreaPoint | null) => void;
	/** What the line is called when it is not net worth ("Price"). */
	name?: string;
	/** Decimal places and cents for values that are not whole money (a rate). */
	moneyFormat?: { places?: number; cents?: false | "auto" };
	/** The spoken summary, when the line is not net worth. */
	summaryText?: (s: {
		from: string;
		start: string;
		to: string;
		end: string;
	}) => string;
}) {
	const t = useTranslations("charts");
	const animate = useChartMotion();
	const [active, setActive] = useState<number | null>(null);
	const text = useMoneyText(moneyFormat);
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
	const show = (index: number | null) => {
		setActive(index);
		onScrub?.(index === null ? null : (points[index] ?? null));
	};
	const scrub = (state: { activeTooltipIndex?: unknown }) => {
		const point = scrubPoint(points, state.activeTooltipIndex);
		show(point ? points.indexOf(point) : null);
	};
	const key = (e: KeyboardEvent) => {
		const step: Record<string, number> = {
			ArrowLeft: -1,
			ArrowRight: 1,
			PageDown: -7,
			PageUp: 7,
		};
		if (e.key === "Escape") return show(null);
		let next: number | null | undefined;
		if (e.key in step) next = stepScrub(points, active, step[e.key] ?? 0);
		else if (e.key === "Home") next = stepScrub(points, null, 1);
		else if (e.key === "End") next = stepScrub(points, null, -1);
		if (next === undefined) return;
		e.preventDefault();
		show(next);
	};
	const shown = active === null ? null : (points[active] ?? null);
	const current = shown ?? last;
	const summaryLabel = (summaryText ?? ((s) => t("area.summary", s)))({
		from: first ? fmt(first.date) : "",
		start: first?.value ? text(first.value) : t("noData"),
		to: last ? fmt(last.date) : "",
		end: last?.value ? text(last.value) : t("noData"),
	});
	const chart = (
		<ChartFrame height={height} summary={summaryLabel}>
			<ChartContainer
				className="aspect-auto size-full touch-pan-y"
				config={{
					value: { label: name ?? t("area.label"), color: COLOR.accent },
				}}
			>
				<AreaChart
					data={data}
					margin={MARGIN.area}
					onMouseLeave={() => show(null)}
					onMouseMove={scrub}
					onTouchEnd={() => show(null)}
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
					{shown?.value ? (
						<ReferenceLine stroke={COLOR.axis} x={shown.date} />
					) : null}
					<Area
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
					{(shown?.value ?? last?.value) && (
						<ReferenceDot
							fill={COLOR.accent}
							r={STROKE.dot}
							stroke={COLOR.ring}
							strokeWidth={STROKE.dotRing}
							x={(shown?.value ? shown : last)?.date}
							y={(shown?.value ?? last?.value)?.minor}
						/>
					)}
				</AreaChart>
			</ChartContainer>
		</ChartFrame>
	);
	if (!onScrub) return chart;
	return (
		// biome-ignore lint/a11y/useSemanticElements: a chart has no native element; this is the ARIA slider pattern
		<div
			aria-label={summaryLabel}
			aria-orientation="horizontal"
			aria-valuemax={points.length - 1}
			aria-valuemin={0}
			aria-valuenow={active ?? points.length - 1}
			aria-valuetext={
				current?.value
					? t("area.pick", {
							date: fmt(current.date),
							amount: text(current.value),
						})
					: t("noData")
			}
			className="rounded-ctl focus-visible:outline-brand outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
			onBlur={() => show(null)}
			onKeyDown={key}
			role="slider"
			tabIndex={0}
		>
			{chart}
		</div>
	);
}
