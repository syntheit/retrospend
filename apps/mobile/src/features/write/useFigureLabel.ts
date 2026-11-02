import { useCallback } from "react";
import { useTranslations } from "use-intl";
import { figureKey } from "./figures";

/**
 * Names for the figures a write can move or check, in both readings (a line's
 * label, and inside a sentence). The pool is named by the book's style: "Not
 * planned yet" outside Every dollar, "To assign" in it. A write about one
 * person passes their name, which words the figures that are theirs. An id
 * this phone has no name for reads "another figure" rather than a raw id.
 */
export function useFigureLabel(
	opts: { poolName?: string; person?: string } = {},
) {
	const { poolName, person } = opts;
	const t = useTranslations("mobile.figures.name");
	const inline = useTranslations("mobile.figures.inline");
	return useCallback(
		(id: string): { name: string; inline: string } => {
			const key = figureKey(id);
			if (key === "budget_notPlannedYet" && poolName) {
				return { name: poolName, inline: poolName };
			}
			// The keys are built at run time, so they can not be checked against the catalog.
			const values = { name: person ?? "" };
			const pick = (tr: typeof t | typeof inline): string => {
				const named = `${key}Named`;
				const k = person && tr.has(named as "other") ? named : key;
				return tr.has(k as "other") ? tr(k as "other", values) : tr("other");
			};
			return { name: pick(t), inline: pick(inline) };
		},
		[t, inline, poolName, person],
	);
}
