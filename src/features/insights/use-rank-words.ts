"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { usePercent } from "~/components/rows/percent";
import { categoryTone } from "~/server/services/expense-list/category-tone";
import { api } from "~/trpc/react";
import type { CategoryRefs, RankWords } from "./insights-vm";

/** The viewer's categories by id, each with the glyph and color it shows. */
export function useCategoryRefs(): CategoryRefs {
	const categories = api.categories.getAll.useQuery(undefined, {
		staleTime: 60_000,
	});
	return useMemo(
		() =>
			new Map(
				(categories.data ?? []).map((c) => [
					c.id,
					{ name: c.name, icon: c.icon, tone: categoryTone(c.color) },
				]),
			),
		[categories.data],
	);
}

/** The words a ranked row adds around a number. */
export function useRankWords(): RankWords {
	const t = useTranslations("insights.rank");
	const percent = usePercent();
	return useMemo(
		() => ({
			none: t("none"),
			fresh: t("new"),
			change: (basis) => percent(basis, { signed: true, digits: 0 }),
		}),
		[t, percent],
	);
}
