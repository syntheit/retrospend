"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import type { MoneyValue } from "~/components/money/format";
import { Money } from "~/components/money/money";
import type { CategoryRef } from "~/components/rows/types";
import { getCategoryIcon } from "~/lib/category-icons";
import { cn } from "~/lib/cn";
import { ChartEmpty, useMoneyText } from "./chart-frame";
import { barShare, COLOR, categoryColor, seriesColor, THIN } from "./spec";

export type RankedItem = {
	id: string;
	label: string;
	/** Null: the amount cannot be worked out (a missing rate); the row stays and says so. */
	value: MoneyValue | null;
	/** A category: its bare glyph and color carry identity (category charts only). */
	category?: CategoryRef;
	/** A series slot for non-category rankings. */
	series?: number;
	/** The amount's figures registry key (with its scope), for the e2e audit. */
	figure?: string;
	/** Opens the rows behind the amount (Activity, filtered). */
	href?: string;
	/** A short muted word after the label, from the server ("+53%", "new"). */
	note?: string;
};

const ROW = "grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5";
/** A linked row is a 44pt target on a phone (GUIDELINE §14). */
const LINKED = "max-md:min-h-row max-md:content-center";

/**
 * Ranked bars: the biggest first, one row each with the label, the amount
 * and a thin accent bar on a raised track. A category shows its bare glyph
 * in its color; the bars stay one color (no rainbow).
 */
export function RankedBars({ items }: { items: RankedItem[] }) {
	const t = useTranslations("charts");
	const text = useMoneyText();
	const unavailable = useTranslations("kit.money")("unavailable");
	const max = Math.max(0, ...items.map((i) => i.value?.minor ?? 0));
	if (!items.length) return <ChartEmpty height={THIN.ranked * 8} />;
	return (
		<ul
			aria-label={t("ranked.summary", {
				list: items
					.map((i) => `${i.label} ${i.value ? text(i.value) : unavailable}`)
					.join(", "),
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
				const body = (
					<>
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
							{item.note && (
								<span className="text-fg-3 text-meta shrink-0">
									{item.note}
								</span>
							)}
						</span>
						<Money
							figure={item.value ? item.figure : undefined}
							missing="unavailable"
							value={item.value}
						/>
						<span
							aria-hidden="true"
							className="rounded-chip bg-raised col-span-2 block overflow-hidden"
							style={{ height: THIN.ranked }}
						>
							<span
								className="rounded-chip block h-full"
								style={
									{
										width: `${item.value ? barShare(item.value.minor, max) : 0}%`,
										background: fill,
									} as CSSProperties
								}
							/>
						</span>
					</>
				);
				return (
					<li key={item.id}>
						{item.href ? (
							<Link
								className={cn(
									ROW,
									LINKED,
									"rounded-ctl focus-visible:outline-brand can-hover:hover:*:first:underline focus-visible:outline-2 focus-visible:outline-offset-4",
								)}
								href={item.href}
							>
								{body}
							</Link>
						) : (
							<div className={ROW}>{body}</div>
						)}
					</li>
				);
			})}
		</ul>
	);
}
