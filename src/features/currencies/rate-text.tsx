"use client";

import { useRateFormat } from "~/components/money/use-rate-format";
import { cn } from "~/lib/cn";
import type { RatePrice } from "./types";

/**
 * A price as the server decided it, worded by the shared rate formatter
 * (R8): "1 USD = 1,545.20 ARS", the direction whose number is at least 1.
 * `showBase` is false where the page already names the one unit every price
 * shares ("1 USD in ..."): the cell then holds the number and its code.
 */
export function RateText({
	price,
	showBase = true,
	className,
}: {
	price: RatePrice;
	showBase?: boolean;
	className?: string;
}) {
	const fmt = useRateFormat();
	// The price counts `minor` x 10^-places of the row's currency per 1 base.
	const perBase = price.minor / 10 ** price.places;
	const text = showBase
		? fmt.rate(price.base, price.currency, perBase)
		: fmt.inUnit(price.base, price.base, price.currency, perBase);
	return (
		<span className={cn("whitespace-nowrap tabular-nums", className)}>
			{text}
		</span>
	);
}
