"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { AllocationBar } from "~/components/charts/allocation-bar";
import {
	type AreaPoint,
	NetWorthArea,
} from "~/components/charts/net-worth-area";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import { usePercent } from "~/components/rows/percent";
import { Segmented } from "~/components/ui/segmented";
import { useIsMobile } from "~/hooks/use-mobile";
import { RANGES, type WealthRange, type WealthView } from "./types";

/**
 * The one hero (R3): net worth, its 30-day change, the area chart with
 * range chips and scrub, the assets by group bar, then liquid assets and
 * runway as key-value rows. Every number comes from the server view.
 */
export function NetWorthHero({ view }: { view: WealthView }) {
	const t = useTranslations("wealthPage");
	const { day } = useRowDates();
	const phone = useIsMobile();
	const [range, setRange] = useState<WealthRange>("1M");
	const [scrub, setScrub] = useState<AreaPoint | null>(null);
	const empty = view.groups.length === 0;
	const points = view.series[range];
	return (
		<section aria-labelledby="nw-label">
			<div className="flex flex-wrap items-end gap-4">
				<div className="min-w-0 flex-1">
					<div className="text-fg-2 text-small" id="nw-label">
						{t("netWorth")}
					</div>
					<div className="text-fg text-hero my-1">
						{scrub?.value ? (
							<Money value={scrub.value} />
						) : (
							<Money value={view.netWorth} />
						)}
					</div>
					<div className="text-fg-2 text-small min-h-5">
						{scrub ? (
							<span className="text-fg font-semibold">{day(scrub.date)}</span>
						) : (
							<Change view={view} />
						)}
					</div>
				</div>
				{empty ? null : (
					<Segmented
						className="self-start max-md:w-full"
						full={phone}
						label={t("range")}
						onChange={setRange}
						options={RANGES.map((r) => ({ value: r, label: t(`ranges.${r}`) }))}
						value={range}
					/>
				)}
			</div>
			{empty ? (
				<p className="text-fg-2 text-small mt-3">{t("emptyTrend")}</p>
			) : (
				<div className="mt-3">
					<NetWorthArea
						currency={view.home}
						height={220}
						label={range === "1Y" ? "month" : "day"}
						onScrub={setScrub}
						points={points}
					/>
				</div>
			)}
			{empty ? null : <Allocation view={view} />}
			<KeyValues view={view} />
		</section>
	);
}

function Change({ view }: { view: WealthView }) {
	const t = useTranslations("wealthPage");
	const percent = usePercent();
	if (!view.change30 || view.groups.length === 0) return null;
	const { amount, basis } = view.change30;
	return (
		<span>
			<Money sign="exceptZero" value={amount} />
			{basis != null ? (
				<span className="tabular-nums">
					{" "}
					({percent(basis, { signed: true })})
				</span>
			) : null}{" "}
			{t("in30Days")}
		</span>
	);
}

function Allocation({ view }: { view: WealthView }) {
	const t = useTranslations("wealthPage");
	if (!view.allocation.length) return null;
	return (
		<div className="mt-6">
			<div className="text-fg-2 text-small mb-2">{t("assetsByGroup")}</div>
			<AllocationBar
				items={view.allocation.map((s) => ({
					id: s.key,
					label: t(`groups.${s.key}`),
					value: s.value,
					share: s.share,
					series: s.series ?? 1,
				}))}
				legend="inline"
			/>
		</div>
	);
}

function KeyValues({ view }: { view: WealthView }) {
	const t = useTranslations("wealthPage");
	return (
		<dl className="mt-3 flex flex-col">
			<div className="min-h-row border-line text-fg-2 text-body flex items-center gap-2 border-t">
				<dt className="flex-1">{t("liquidAssets")}</dt>
				<dd className="text-fg font-semibold">
					<Money value={view.liquid} />
				</dd>
			</div>
			{view.runway ? (
				<div className="min-h-row border-line text-fg-2 text-body flex items-center gap-2 border-t">
					<dt className="flex-1">
						{t("runway")}{" "}
						<span className="text-fg-3 text-meta">
							{t.rich("runwayAt", {
								amount: () => <Money value={view.runway?.monthly ?? null} />,
							})}
						</span>
					</dt>
					<dd className="text-fg font-semibold tabular-nums">
						{t("months", { months: view.runway.months })}
					</dd>
				</div>
			) : null}
		</dl>
	);
}
