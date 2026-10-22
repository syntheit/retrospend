"use client";

import { useTranslations } from "next-intl";
import type { MoneyValue } from "~/components/money/format";
import { Money } from "~/components/money/money";
import { usePercent } from "~/components/rows/percent";
import type { Basis } from "~/components/rows/types";
import { Tip } from "~/components/ui/tooltip";
import { cn } from "~/lib/cn";
import { useMoneyText } from "./chart-frame";
import { seriesColor, THIN } from "./spec";

export type AllocationItem = {
	id: string;
	label: string;
	value: MoneyValue;
	/** Its share of the total, from the server. */
	share: Basis;
	/** Series slot by size, largest first (the server sends the order). */
	series: number;
};

function Dot({ series }: { series: number }) {
	return (
		<span
			aria-hidden="true"
			className="rounded-chip inline-block size-2 shrink-0"
			style={{ background: seriesColor(series) }}
		/>
	);
}

/**
 * Allocation: one 100% bar split by series, with legend rows (label, amount,
 * share) or an inline legend. It replaces the allocation donut. Shares come
 * from the server; the bar only lays them out.
 */
export function AllocationBar({
	items,
	legend = "rows",
}: {
	items: AllocationItem[];
	legend?: "rows" | "inline" | "none";
}) {
	const t = useTranslations("charts");
	const percent = usePercent();
	const text = useMoneyText();
	const pct = (b: Basis) => percent(b, { digits: 0 });
	return (
		<div>
			<div
				aria-label={t("allocation.summary", {
					list: items.map((i) => `${i.label} ${pct(i.share)}`).join(", "),
				})}
				className="rounded-chip flex overflow-hidden"
				role="img"
				style={{ height: THIN.allocation, gap: THIN.gap }}
			>
				{items.map((i) => (
					<Tip content={`${i.label}: ${text(i.value)}`} key={i.id}>
						<span
							className="block h-full min-w-1"
							style={{
								width: `${i.share / 100}%`,
								background: seriesColor(i.series),
							}}
						/>
					</Tip>
				))}
			</div>
			{legend === "inline" && (
				<div className="text-fg-2 text-small mt-2 flex flex-wrap gap-x-4 gap-y-1">
					{items.map((i) => (
						<span className="inline-flex items-center gap-2" key={i.id}>
							<Dot series={i.series} />
							{i.label}
							<span className="text-fg-3 text-meta tabular-nums">
								{pct(i.share)}
							</span>
						</span>
					))}
				</div>
			)}
			{legend === "rows" && (
				<ul className="text-small mt-3 flex flex-col">
					{items.map((i, n) => (
						<li
							className={cn(
								"grid min-h-8 grid-cols-[auto_1fr_auto_auto] items-center gap-2",
								n > 0 && "border-line border-t",
							)}
							key={i.id}
						>
							<Dot series={i.series} />
							<span className="text-fg truncate">{i.label}</span>
							<Money value={i.value} />
							<span className="text-fg-3 text-meta min-w-10 text-right tabular-nums">
								{pct(i.share)}
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
