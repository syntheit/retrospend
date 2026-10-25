"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { RankedBars } from "~/components/charts/ranked-bars";
import { Section } from "~/components/layout/section";
import { Button } from "~/components/ui/button";
import type { SummaryDTO } from "~/server/services/insights/types";
import { categoryItems } from "./insights-vm";
import { type PartQuery, PartUnavailable, RankedSkeleton } from "./part-states";
import { useCategoryRefs, useRankWords } from "./use-rank-words";

/** The biggest categories show first; the rest open with one button. */
const FIRST = 8;

/**
 * By category: ranked bars in one accent, the category's glyph carrying
 * identity, with the change against the period before when Compare is on.
 * Each row opens its expenses in Activity.
 */
export function CategorySection({
	query,
	compare,
	hrefOf,
}: {
	query: PartQuery<SummaryDTO>;
	compare: boolean;
	hrefOf: (categoryId: string) => string;
}) {
	const t = useTranslations("insights.category");
	const refs = useCategoryRefs();
	const words = useRankWords();
	const [all, setAll] = useState(false);
	const items = useMemo(
		() =>
			query.data
				? categoryItems(query.data.categories, refs, { compare, words, hrefOf })
				: [],
		[query.data, refs, compare, words, hrefOf],
	);
	const shown = all ? items : items.slice(0, FIRST);
	return (
		<Section
			count={query.data ? items.length : undefined}
			id="by-category"
			title={t("title")}
		>
			{query.isPending ? (
				<RankedSkeleton rows={6} />
			) : query.isError ? (
				<PartUnavailable onRetry={() => void query.refetch()} />
			) : (
				<>
					<RankedBars items={shown} />
					{items.length > FIRST && (
						<Button
							className="mt-2"
							kind="ghost"
							onClick={() => setAll((v) => !v)}
							size="sm"
						>
							{all ? (
								<ChevronUp aria-hidden="true" />
							) : (
								<ChevronDown aria-hidden="true" />
							)}
							{all
								? t("showFewer")
								: t("showMore", { count: items.length - FIRST })}
						</Button>
					)}
				</>
			)}
		</Section>
	);
}
