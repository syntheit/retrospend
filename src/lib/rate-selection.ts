import { isValidRate, RATE_TYPE_PRIORITY } from "@retrospend/domain/money";
export {
	CUSTOM_RATE_TYPE,
	HOME_DEFAULT_RATE_TYPES,
	isRateTypeKey,
	preferredRateType,
	rateTypeFromPricingSource,
} from "@retrospend/domain/rate-booking";

/**
 * Rate types (N73, ADD-EXPENSE-R2 T7). A rate type names one row kind of the
 * exchange_rate table for a currency (official, blue, mep, crypto, ...), or
 * "custom" for a rate the user typed. An entry's rate type applies to both
 * legs of its conversion, through USD: each leg uses that type when its
 * currency has it and its best rate otherwise. So the types a pair offers are
 * the union of both currencies' types, and a USD entry in an ARS home offers
 * the ARS types (USD itself has none).
 */

/** Picker order (ADD-EXPENSE-R2 §3.4); any other type follows A to Z. */
const DISPLAY_ORDER = ["official", "blue", "card", "mep"];

function displayRank(type: string): number {
	const i = DISPLAY_ORDER.indexOf(type);
	return i === -1 ? DISPLAY_ORDER.length : i;
}

/** The table rate types a pair offers, in picker order (Custom is always offered on top). */
export function pairRateTypes(
	entryTypes: Iterable<string>,
	homeTypes: Iterable<string>,
): string[] {
	return [...new Set([...entryTypes, ...homeTypes])].sort(
		(a, b) => displayRank(a) - displayRank(b) || a.localeCompare(b),
	);
}

function priorityRank(type: string): number {
	const i = (RATE_TYPE_PRIORITY as readonly string[]).indexOf(type);
	return i === -1 ? RATE_TYPE_PRIORITY.length : i;
}

/**
 * The type a picker starts on: the preference when the pair offers it, else
 * the table's own order (blue, official, crypto, then A to Z, as pickBestRate
 * ranks them). Null when the pair has no rates at all.
 */
export function pickDefaultRateType(
	offered: readonly string[],
	preferred: string | null,
): string | null {
	if (preferred && offered.includes(preferred)) return preferred;
	const ranked = [...offered].sort(
		(a, b) => priorityRank(a) - priorityRank(b) || a.localeCompare(b),
	);
	return ranked[0] ?? null;
}

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
		(activeType && activeType !== "custom"
			? getRateByType(activeType)
			: null) ?? getDefaultRate();
	return preferred ? { type: preferred.type, rate: preferred.rate } : null;
}
