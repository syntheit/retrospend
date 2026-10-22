"use client";

import { CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Empty } from "~/components/ui/empty-state";
import { cn } from "~/lib/cn";
import { NeedsYouItem } from "./needs-you-item";
import type { NeedsYouItemVM } from "./types";

/**
 * NeedsYouList: every kind of waiting thing in one style, replacing the
 * verification, settlement, import and recurring banners. Flat with
 * hairlines on desktop, a list group on phone. Nothing waiting: All clear.
 */
export function NeedsYouList({
	items,
	onAction,
	variant = "flat",
	className,
}: {
	items: NeedsYouItemVM[];
	onAction?: (item: NeedsYouItemVM) => void;
	variant?: "flat" | "group";
	className?: string;
}) {
	const t = useTranslations("needsYou");
	if (!items.length)
		return (
			<Empty hint={t("emptyHint")} icon={CircleCheck} title={t("empty")} />
		);
	return (
		<ul
			aria-label={t("label")}
			className={cn(
				"*:border-line flex flex-col *:border-b *:last:border-b-0",
				variant === "group" &&
					"rounded-panel border-line bg-surface overflow-hidden border",
				className,
			)}
		>
			{items.map((item) => (
				<NeedsYouItem
					item={item}
					key={item.id}
					onAction={onAction}
					variant={variant}
				/>
			))}
		</ul>
	);
}
