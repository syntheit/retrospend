import type { ActionDef } from "@/ui/actionRegistry";

/**
 * What can be done to a currency row, in one place: Convert, Favorite (or
 * Unfavorite), and History. A currency with no rate cannot be starred, and a
 * crypto asset has no history.
 */
export type CurrencyActionId = "convert" | "favorite" | "history";

export const CURRENCY_ACTIONS: Record<
	CurrencyActionId,
	ActionDef<CurrencyActionId>
> = {
	convert: { id: "convert" },
	favorite: { id: "favorite" },
	history: { id: "history" },
};

export function currencyActionsOf(row: {
	favorite: boolean;
	rateId: string | null;
	crypto: boolean;
}): CurrencyActionId[] {
	return [
		"convert",
		...(row.favorite || row.rateId !== null ? (["favorite"] as const) : []),
		...(row.crypto ? [] : (["history"] as const)),
	];
}
