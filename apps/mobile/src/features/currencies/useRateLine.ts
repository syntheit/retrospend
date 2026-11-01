import { useCallback } from "react";
import { useRateFormat } from "@/lib/rateFormat";
import { useRateTypeName } from "@/lib/rateTypes";
import { useRateTable } from "./useCurrencies";

/**
 * "Blue · 1 USD = 1,545.20 ARS" for a currency at a rate type, from the
 * server's rate table (cached, so it works offline). A type never shows
 * without its number (R8): null when the table has no price for the type.
 */
export function useRateLine() {
	const { state } = useRateTable();
	const fmt = useRateFormat();
	const name = useRateTypeName();
	const rows = state.status === "ready" ? state.data.rows : null;
	return useCallback(
		(currency: string, type: string): string | null => {
			const price = rows
				?.find((r) => r.code === currency)
				?.rates.find((r) => r.type === type)?.price;
			if (!price) return null;
			return fmt.typed(
				name(type),
				price.base,
				price.currency,
				price.minor / 10 ** price.places,
			);
		},
		[rows, fmt, name],
	);
}
