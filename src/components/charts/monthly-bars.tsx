"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import type { MoneyValue } from "~/components/money/format";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import { ChartContainer, ChartTooltip } from "~/components/ui/chart";
import {
	ChartEmpty,
	ChartFrame,
	ChartTip,
	isEmptySeries,
	useAxisTick,
	useChartMotion,
	useMoneyText,
} from "./chart-frame";
import { BAR, COLOR, LABEL, MARGIN, MOTION, niceMax } from "./spec";

export type MonthTotal = {
	/** ISO date in the month ("2026-10-01"). */
	month: string;
	/** What the server counts as spent that month; null when unknown. */
	total: MoneyValue | null;
};

/**
 * Monthly bars: spending per month, the highlighted month (this one, by
 * default) in the accent and the others dimmed. A month with no data is a
 * gap, never a zero bar.
 */
export function MonthlyBars({
	months,
	currency,
	highlight,
	height = 200,
}: {
	months: MonthTotal[];
	currency: string;
	/** Index of the month to highlight; the last one by default. */
	highlight?: number;
	height?: number;
}) {
	const t = useTranslations("charts");
	const animate = useChartMotion();
	const tick = useAxisTick(currency);
	const text = useMoneyText();
	const { monthShort, month } = useRowDates();
	const hi = highlight ?? months.length - 1;
	const data = useMemo(
		() =>
			months.map((m) => ({
				key: m.month,
				label: monthShort(m.month),
				value: m.total?.minor ?? null,
			})),
		[months, monthShort],
	);
	if (isEmptySeries(data.map((d) => d.value)))
		return <ChartEmpty height={height} />;
	const top = niceMax(Math.max(0, ...data.map((d) => d.value ?? 0)));
	// Every month the chart shows, so a screen reader hears what a glance sees.
	const list = months
		.map((m) => `${month(m.month)} ${m.total ? text(m.total) : t("noData")}`)
		.join(", ");
	return (
		<ChartFrame height={height} summary={t("bars.summary", { list })}>
			<ChartContainer
				className="aspect-auto size-full"
				config={{ value: { label: t("bars.label"), color: COLOR.accent } }}
			>
				<BarChart data={data} margin={MARGIN.bars}>
					<CartesianGrid stroke={COLOR.grid} vertical={false} />
					<XAxis
						axisLine={false}
						dataKey="label"
						height={22}
						tick={LABEL}
						tickLine={false}
					/>
					<YAxis
						axisLine={false}
						domain={[0, top]}
						tick={({ y, payload }) => (
							<text {...LABEL} dy={4} textAnchor="start" x={0} y={y}>
								{tick(Number(payload.value))}
							</text>
						)}
						tickLine={false}
						ticks={[0, top / 2, top]}
						width={BAR.yAxisWidth}
					/>
					<ChartTooltip
						content={({ active, payload }) =>
							active && payload?.[0]?.payload.value != null ? (
								<ChartTip label={payload[0].payload.label}>
									<Money
										value={{ minor: payload[0].payload.value, currency }}
									/>
								</ChartTip>
							) : null
						}
						cursor={false}
					/>
					<Bar
						animationDuration={MOTION.duration}
						dataKey="value"
						isAnimationActive={animate}
						maxBarSize={BAR.maxSize}
						radius={BAR.radius}
					>
						{data.map((d, i) => (
							<Cell
								fill={i === hi ? COLOR.accent : COLOR.accentDim}
								key={d.key}
							/>
						))}
					</Bar>
				</BarChart>
			</ChartContainer>
		</ChartFrame>
	);
}
