"use client";

import type { Span } from "@retrospend/domain/insights";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { RankedBars } from "~/components/charts/ranked-bars";
import { Section } from "~/components/layout/section";
import { Money } from "~/components/money/money";
import { FilterChip } from "~/components/ui/chip";
import { cn } from "~/lib/cn";
import type { YtdDTO } from "~/server/services/insights/types";
import { ytdItems } from "./insights-vm";
import { type PartQuery, PartUnavailable, RankedSkeleton } from "./part-states";
import { FIGURE_LINK, PeriodWas } from "./period-was";
import { useRangeLabel } from "./range-label";
import { useCategoryRefs, useRankWords } from "./use-rank-words";

/**
 * Year to date against the same span last year, by category. Show in USD
 * totals the same rows at the USD value each expense was saved with, so
 * there is no rate to pick; a currency with no value says so by name.
 */
export function YtdSection({
	query,
	today,
	named,
	hrefOf,
}: {
	query: PartQuery<YtdDTO>;
	/** Currencies the lead already names (a fact appears once). */
	named: readonly string[];
	today: string;
	/** Activity's link for this page's filters over a span, narrowed to a category. */
	hrefOf: (span: Span, categoryId?: string) => string;
}) {
	const t = useTranslations("insights.ytd");
	const [usd, setUsd] = useState(false);
	const refs = useCategoryRefs();
	const words = useRankWords();
	const label = useRangeLabel(today);
	const data = query.data;
	const items = useMemo(
		() =>
			data
				? ytdItems(data.categories, refs, {
						usd,
						words,
						hrefOf: (id) => hrefOf(data.thisYear, id),
					})
				: [],
		[data, refs, usd, words, hrefOf],
	);
	const toggle = (
		<FilterChip onClick={() => setUsd((v) => !v)} selected={usd}>
			{t("showUsd")}
		</FilterChip>
	);
	return (
		<Section end={toggle} id="ytd" title={t("title")}>
			{query.isPending ? (
				<RankedSkeleton rows={5} />
			) : query.isError || !data ? (
				<PartUnavailable onRetry={() => void query.refetch()} />
			) : (
				<YtdBody
					data={data}
					hrefOf={hrefOf}
					items={items}
					label={label}
					named={named}
					usd={usd}
				/>
			)}
		</Section>
	);
}

function YtdBody({
	data,
	named,
	items,
	usd,
	label,
	hrefOf,
}: {
	data: YtdDTO;
	named: readonly string[];
	items: ReturnType<typeof ytdItems>;
	usd: boolean;
	label: (range: Span) => string;
	hrefOf: (span: Span, categoryId?: string) => string;
}) {
	const t = useTranslations("insights.ytd");
	const key = usd ? "usd" : "home";
	const total = data.total[key];
	const last = data.lastYearTotal[key];
	const change = usd ? data.total.usdChangePct : data.total.changePct;
	const unnamed = data.missingRates.filter((c) => !named.includes(c));
	return (
		<>
			{usd && <p className="text-fg-3 text-meta mb-2">{t("usdNote")}</p>}
			<p className="text-fg-2 text-body mb-4">
				<Link
					className={cn(FIGURE_LINK, "block w-fit")}
					href={hrefOf(data.thisYear)}
				>
					<Money
						className="text-fg text-section"
						figure={total.value ? total.id : undefined}
						missing="noRate"
						value={total.value}
					/>
				</Link>
				{label(data.thisYear)}
				{last.value && (
					<>
						<span aria-hidden="true" className="text-fg-3 mx-2">
							·
						</span>
						<PeriodWas
							changePct={change}
							figure={last.id}
							href={hrefOf(data.lastYear)}
							label={label(data.lastYear)}
							value={last.value}
						/>
					</>
				)}
			</p>
			{items.length > 0 ? (
				<RankedBars items={items} />
			) : (
				<p className="text-fg-3 text-small">{t("none")}</p>
			)}
			{unnamed.length > 0 && (
				<p className="text-fg-3 text-small mt-3">
					{t("missingRates", { currencies: unnamed.join(", ") })}
				</p>
			)}
		</>
	);
}
