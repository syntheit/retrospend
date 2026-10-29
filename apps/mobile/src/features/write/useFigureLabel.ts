import { useCallback } from "react";
import { useTranslations } from "use-intl";
import { figureKey } from "./figures";

/**
 * Names for the figures a write can move or check, in both readings (a line's
 * label, and inside a sentence). The pool is named by the book's style: "Not
 * planned yet" outside Every dollar, "To assign" in it. An id this phone has
 * no name for reads "another figure" rather than a raw id.
 */
export function useFigureLabel(poolName?: string) {
	const t = useTranslations("mobile.budget.figures");
	const inline = useTranslations("mobile.budget.figuresInline");
	return useCallback(
		(id: string): { name: string; inline: string } => {
			const key = figureKey(id);
			if (key === "budget_notPlannedYet" && poolName) {
				return { name: poolName, inline: poolName };
			}
			return t.has(key as "other")
				? { name: t(key as "other"), inline: inline(key as "other") }
				: { name: t("other"), inline: inline("other") };
		},
		[t, inline, poolName],
	);
}
