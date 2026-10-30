import { formatPercent } from "@retrospend/domain/format-percent";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyText } from "@/features/read/useMoneyText";
import { useMoneyLocale } from "@/lib/money";
import { useTheme } from "@/theme";
import { AreaChart, type AreaPoint } from "@/ui/charts/AreaChart";
import { Glyph } from "@/ui/Glyph";
import { Hero } from "@/ui/Hero";
import { ListGroup, ListRow } from "@/ui/List";
import { heroCents } from "@/ui/Money";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import { AllocationBar } from "./AllocationBar";
import {
	DEFAULT_RANGE,
	datesFor,
	RANGES,
	sliceRange,
	type WealthRange,
} from "./series";
import type { NetWorth, WealthSummary } from "./source";

const CHART_HEIGHT = 220;

/**
 * Net worth: the one hero of Wealth. The number and its 30-day change (with
 * the percent) are the server's summary; the change is a link to the sheet
 * that says why it moved. The chart is the server's daily series on the one
 * area chart, opening on a month; holding and dragging swaps the number for
 * that day's. Under it: what you own by group, the server's shares.
 */
export function NetWorthHero({
	netWorth,
	summary,
	onChange,
}: {
	netWorth: NetWorth;
	summary: WealthSummary;
	/** Opens the sheet that says why net worth moved. */
	onChange: () => void;
}) {
	const t = useTranslations("mobile.wealth");
	const tm = useTranslations("mobile.money");
	const format = useFormatter();
	const money = useMoneyText();
	const locale = useMoneyLocale();
	const { color, size, space } = useTheme();
	const [range, setRange] = useState<WealthRange>(DEFAULT_RANGE);
	const [scrub, setScrub] = useState<AreaPoint | null>(null);
	const points = useMemo(
		() => sliceRange(netWorth.series, range),
		[netWorth.series, range],
	);
	const cents = heroCents(summary.home);
	const whole = { cents } as const;

	const amount = scrub
		? scrub.value
			? money(scrub.value, whole)
			: tm("noRate")
		: money(summary.netWorth, whole);

	const change = summary.change;
	const changeText = change
		? change.basis === null
			? t("change", {
					amount: money(change.total, { ...whole, sign: "exceptZero" }),
					days: change.days,
				})
			: t("changePercent", {
					amount: money(change.total, { ...whole, sign: "exceptZero" }),
					percent: formatPercent(change.basis, {
						locale,
						digits: 1,
						sign: "exceptZero",
					}),
					days: change.days,
				})
		: null;
	// With the parts the server gave, the change is a link to why it moved.
	const sub = scrub ? (
		format.dateTime(new Date(`${scrub.date}T12:00:00Z`), {
			dateStyle: "medium",
			timeZone: "UTC",
		})
	) : changeText === null ? undefined : netWorth.change ? (
		<Pressable
			accessibilityHint={t("whyHint")}
			accessibilityRole="link"
			hitSlop={space[3]}
			onPress={onChange}
		>
			<View
				style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}
			>
				<Text
					numberOfLines={1}
					style={{ flexShrink: 1 }}
					tone="fg2"
					variant="small"
				>
					{changeText}
				</Text>
				<Glyph color={color.fg3} name="ChevronRight" size={size.icon.phone} />
			</View>
		</Pressable>
	) : (
		changeText
	);

	return (
		<View style={{ gap: space[4], padding: space[4] }}>
			<Hero label={t("netWorth")} sub={sub} value={amount} />
			{netWorth.series.length > 1 ? (
				<View style={{ gap: space[3] }}>
					<AreaChart
						dates={datesFor(range)}
						height={CHART_HEIGHT}
						label={t("chart.label", { range: t(`chart.ranges.${range}`) })}
						onScrub={setScrub}
						points={points}
					/>
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
						stretch
						value={range}
					/>
				</View>
			) : null}
			<AllocationBar items={summary.allocation} />
		</View>
	);
}

/**
 * Liquid assets and the runway, as two rows in an inset group (the server's
 * figures): the runway says how long liquid money lasts at the average
 * monthly spending.
 */
export function KeyFigures({ summary }: { summary: WealthSummary }) {
	const t = useTranslations("mobile.wealth");
	const money = useMoneyText();
	const whole = { cents: heroCents(summary.home) } as const;
	const runway = summary.runway;
	return (
		<ListGroup>
			<ListRow
				end={
					<Text tabular weight="semibold">
						{money(summary.liquid, whole)}
					</Text>
				}
				title={t("liquid")}
			/>
			{runway ? (
				<ListRow
					end={
						<Text tabular weight="semibold">
							{t("months", { months: runway.months })}
						</Text>
					}
					sub={t("runwayAt", { amount: money(runway.monthly, whole) })}
					title={t("runway")}
				/>
			) : null}
		</ListGroup>
	);
}
