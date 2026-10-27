"use client";

import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { cn } from "~/lib/cn";
import { priceCents } from "./price-cents";
import type { RatePrice } from "./types";

/**
 * A price as the server decided it: the single unit it is for ("1 USD =")
 * in muted small text, then the figure in the other currency. `showBase`
 * is false where the page already names the one unit every price shares.
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
	const t = useTranslations("currenciesPage");
	return (
		<span className="whitespace-nowrap">
			{showBase ? (
				<>
					<span className="text-fg-3 text-meta">
						{t("base", { code: price.base })}
					</span>{" "}
				</>
			) : null}
			<Money
				cents={priceCents(price)}
				className={cn(className)}
				places={price.places}
				value={price}
			/>
		</span>
	);
}
