"use client";

import { Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import { Tip } from "~/components/ui/tooltip";
import { cn } from "~/lib/cn";
import type { CurrencyRow } from "./types";

/**
 * The favorite star. A currency with no rate row of its own (USD is the
 * rate table's base) cannot be a favorite yet: the star says why (GAPS).
 */
export function StarButton({
	row,
	onToggle,
}: {
	row: CurrencyRow;
	onToggle: (on: boolean) => void;
}) {
	const t = useTranslations("currenciesPage");
	const blocked = !row.favorite && !row.rateId;
	const label = blocked
		? t("star.unavailable", { code: row.code })
		: row.favorite
			? t("star.remove", { code: row.code })
			: t("star.add", { code: row.code });
	return (
		<Tip content={label}>
			<Button
				aria-disabled={blocked || undefined}
				aria-label={label}
				aria-pressed={row.favorite}
				className={cn("relative z-10", row.favorite ? "text-fg" : "text-fg-3")}
				icon
				kind="ghost"
				onClick={(e) => {
					e.stopPropagation();
					if (!blocked) onToggle(!row.favorite);
				}}
			>
				<Star className={row.favorite ? "fill-current" : undefined} />
			</Button>
		</Tip>
	);
}
