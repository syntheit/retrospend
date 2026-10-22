"use client";

import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import type { MoneyValue } from "~/components/money/format";
import { Money } from "~/components/money/money";
import type { CategoryRef } from "~/components/rows/types";
import { getCategoryIcon } from "~/lib/category-icons";
import { ChartEmpty, useMoneyText } from "./chart-frame";
import { barShare, COLOR, categoryColor, seriesColor, THIN } from "./spec";

export type RankedItem = {
	id: string;
	label: string;
	value: MoneyValue;
	/** A category: its bare glyph and color carry identity (category charts only). */
	category?: CategoryRef;
	/** A series slot for non-category rankings. */
	series?: number;
};

/**
 * Ranked bars: the biggest first, one row each with the label, the amount
 * and a thin accent bar on a raised track. A category shows its bare glyph
 * in its color; the bars stay one color (no rainbow).
 */
export function RankedBars({ items }: { items: RankedItem[] }) {
	const t = useTranslations("charts");
	const text = useMoneyText();
	const max = Math.max(0, ...items.map((i) => i.value.minor));
	if (!items.length) return <ChartEmpty height={THIN.ranked * 8} />;
	return (
		<ul
			aria-label={t("ranked.summary", {
				list: items.map((i) => `${i.label} ${text(i.value)}`).join(", "),
			})}
			className="text-small flex flex-col gap-3"
		>
			{items.map((item) => {
				const Icon = item.category
					? getCategoryIcon(item.category.name, item.category.icon)
					: null;
				// One accent fill for every bar (GUIDELINE §9: no rainbow); a
				// category's glyph carries its identity in its own color.
				const fill = item.series ? seriesColor(item.series) : COLOR.accent;
				const glyph = item.category ? categoryColor(item.category.tone) : fill;
				return (
					<li
						className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5"
						key={item.id}
					>
						<span className="text-fg flex min-w-0 items-center gap-2">
							{Icon && (
								<Icon
									aria-hidden="true"
									className="size-4 shrink-0"
									strokeWidth={1.75}
									style={{ color: glyph }}
								/>
							)}
							<span className="truncate">{item.label}</span>
						</span>
						<Money value={item.value} />
						<span
							aria-hidden="true"
							className="rounded-chip bg-raised col-span-2 block overflow-hidden"
							style={{ height: THIN.ranked }}
						>
							<span
								className="rounded-chip block h-full"
								style={
									{
										width: `${barShare(item.value.minor, max)}%`,
										background: fill,
									} as CSSProperties
								}
							/>
						</span>
					</li>
				);
			})}
		</ul>
	);
}
