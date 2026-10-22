import { isValidRate } from "./money";

interface RateChoice {
	type: string;
	rate: number;
}

/**
 * What a rate picker selects on its own, before the user touches it.
 *
 * - A custom rate stays custom.
 * - A saved rate keeps its saved type (blue stays blue) and its value; nothing
 *   is re-picked, so saving without touching the picker changes nothing.
 * - With no rate yet (new item, or the currency just changed) it picks the
 *   saved type's current rate if there is one, else the default rate, and
 *   reports the rate so the caller can store it.
 *
 * Returns null when there is nothing to select yet.
 */
export function autoRateSelection({
	value,
	activeType,
	isCustomSet,
	getRateByType,
	getDefaultRate,
}: {
	value: number | null | undefined;
	activeType: string | null | undefined;
	isCustomSet: boolean;
	getRateByType: (type: string) => RateChoice | null;
	getDefaultRate: () => RateChoice | null;
}): { type: string; rate?: number } | null {
	if (isCustomSet) return { type: "custom" };
	if (isValidRate(value)) return activeType ? { type: activeType } : null;
	const preferred =
		(activeType && activeType !== "custom" ? getRateByType(activeType) : null) ??
		getDefaultRate();
	return preferred ? { type: preferred.type, rate: preferred.rate } : null;
}
