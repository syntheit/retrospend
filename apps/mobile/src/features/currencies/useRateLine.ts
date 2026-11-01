import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/auth/session";
import { useRateFormat } from "@/lib/rateFormat";
import { useRateTypeName } from "@/lib/rateTypes";
import type { RateTable } from "./source";

/**
 * "Blue · 1 USD = 1,545.20 ARS" for a currency at a rate type, from the
 * server's rate table (read once while `enabled`). A type never shows without
 * its number (R8): null when the table has no price for the type, or has not
 * answered yet.
 */
export function useRateLine(enabled: boolean) {
	const { api } = useSession();
	const fmt = useRateFormat();
	const name = useRateTypeName();
	const [rows, setRows] = useState<RateTable["rows"] | null>(null);
	useEffect(() => {
		if (!enabled || !api) return;
		let live = true;
		try {
			api.currencies
				.rateTable()
				.then((table) => {
					if (live) setRows(table.rows);
				})
				.catch(() => {});
		} catch {
			// No table to read from: the line stays without a number.
		}
		return () => {
			live = false;
		};
	}, [api, enabled]);
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
