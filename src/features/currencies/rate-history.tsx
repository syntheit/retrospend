"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
	type AreaPoint,
	NetWorthArea,
} from "~/components/charts/net-worth-area";
import { Section } from "~/components/layout/section";
import { useRowDates } from "~/components/rows/dates";
import { usePercent } from "~/components/rows/percent";
import { Segmented } from "~/components/ui/segmented";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { useRateLabel } from "~/features/wealth/sheets/rate-type-chips";
import { api } from "~/trpc/react";
import { priceCents } from "./price-cents";
import { RateText } from "./rate-text";
import { HISTORY_RANGES, type HistoryRange, type Rate } from "./types";

const HEIGHT = 200;

/**
 * The history of one currency's price against the home currency (the same
 * unit as the table), per rate type, over a range. The server prices every
 * day; this draws the line and formats what it gets. Scrubbing the chart
 * shows that day's price in the header line.
 */
export function RateHistory({ code }: { code: string }) {
	const t = useTranslations("currenciesPage.history");
	const label = useRateLabel();
	const { short } = useRowDates();
	const percent = usePercent();
	const [range, setRange] = useState<HistoryRange>("3M");
	const [type, setType] = useState<string | null>(null);
	const [scrub, setScrub] = useState<string | null>(null);
	const query = api.exchangeRate.history.useQuery(
		{ currency: code, range },
		{ staleTime: 60_000, placeholderData: keepPreviousData },
	);
	const data = query.data;
	const series =
		data?.series.find((s) => s.type === (type ?? data.defaultType)) ??
		data?.series[0];
	const byDate = useMemo(
		() => new Map(series?.points.map((p) => [p.date, p.price]) ?? []),
		[series],
	);
	const points: AreaPoint[] = useMemo(
		() => series?.points.map((p) => ({ date: p.date, value: p.price })) ?? [],
		[series],
	);
	const last = series?.points[series.points.length - 1];
	const shownDate = scrub && byDate.has(scrub) ? scrub : last?.date;
	const shown: Rate | undefined = shownDate ? byDate.get(shownDate) : undefined;
	const rangeLabels: Record<HistoryRange, string> = {
		"1M": t("range.1M"),
		"3M": t("range.3M"),
		"1Y": t("range.1Y"),
		ALL: t("range.ALL"),
	};

	return (
		<Section
			end={
				<Segmented
					label={t("range.label")}
					onChange={setRange}
					options={HISTORY_RANGES.map((r) => ({
						value: r,
						label: rangeLabels[r],
					}))}
					value={range}
				/>
			}
			id="rate-history"
			title={t("title")}
		>
			{data && data.series.length > 1 ? (
				<div className="mb-2">
					<Select
						kit
						onValueChange={setType}
						value={series?.type ?? data.defaultType ?? ""}
					>
						<SelectTrigger aria-label={t("type")}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{data.series.map((s) => (
								<SelectItem key={s.type} value={s.type}>
									{label(s.type)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			) : null}
			{query.isError ? (
				<p className="text-danger text-small">{t("failed")}</p>
			) : !data ? (
				<Skeleton className="w-full" style={{ height: HEIGHT }} />
			) : !series || series.points.length < 2 || !data.base ? (
				<p className="text-fg-3 text-small py-6 text-center">{t("empty")}</p>
			) : (
				<>
					<div className="mb-1 flex items-baseline justify-between gap-3">
						<div className="text-body text-fg">
							{shown ? (
								<RateText
									className="font-semibold"
									price={{ ...shown, base: data.base }}
								/>
							) : null}
							{shownDate ? (
								<span className="text-fg-3 text-meta ml-2">
									{short(shownDate)}
								</span>
							) : null}
						</div>
						{series.changeBp != null ? (
							<span className="text-fg-3 text-meta tabular-nums">
								{percent(series.changeBp, { signed: true })}
							</span>
						) : null}
					</div>
					<NetWorthArea
						currency={data.home}
						height={HEIGHT}
						label={range === "1M" || range === "3M" ? "day" : "month"}
						moneyFormat={{
							places: shown?.places,
							cents: shown ? priceCents(shown) : "auto",
						}}
						name={t("series")}
						onScrub={(p) => setScrub(p?.date ?? null)}
						points={points}
						summaryText={(s) => t("summary", s)}
					/>
				</>
			)}
		</Section>
	);
}
