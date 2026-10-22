"use client";

import type { ComponentType, CSSProperties } from "react";
import { Progress } from "~/components/ui/progress";
import { getCategoryIcon } from "~/lib/category-icons";
import { cn } from "~/lib/cn";
import type { CategoryRef } from "./types";

/** Category identity in a row: the tinted tile with its glyph (R25, rows only). */
export function CategoryTile({
	category,
	size = "default",
}: {
	category: CategoryRef;
	size?: "default" | "sm";
}) {
	const Icon = getCategoryIcon(category.name, category.icon);
	return (
		<span
			aria-hidden="true"
			className={cn(
				"rounded-ctl inline-flex shrink-0 items-center justify-center bg-[color-mix(in_oklab,var(--c)_15%,var(--surface))] text-(--c)",
				size === "sm" ? "size-6 [&_svg]:size-3.5" : "size-8 [&_svg]:size-4",
			)}
			style={{ "--c": `var(--category-${category.tone})` } as CSSProperties}
		>
			<Icon strokeWidth={1.75} />
		</span>
	);
}

/** A neutral lead tile: money moves, accounts, Needs you items. */
export function IconTile({
	icon: Icon,
	tone = "neutral",
}: {
	icon: ComponentType<{ className?: string; strokeWidth?: number }>;
	tone?: "neutral" | "attention";
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"rounded-ctl inline-flex size-8 shrink-0 items-center justify-center",
				tone === "attention"
					? "bg-attention-bg text-attention-text"
					: "bg-raised text-fg-2",
			)}
		>
			<Icon className="size-4" strokeWidth={1.75} />
		</span>
	);
}

/**
 * The thin progress line under a title, on the Progress primitive: accent on
 * track, attention when over. The server sends the share already capped.
 */
export function RowBar({
	basis,
	over,
	label,
}: {
	/** Hundredths of a percent, 0 to 10000, from the server. */
	basis: number;
	over: boolean;
	label: string;
}) {
	return (
		<Progress
			aria-label={label}
			className={cn(
				"bg-raised mt-2 h-1",
				over ? "*:bg-attention" : "*:bg-ds-accent",
			)}
			value={Math.min(basis, 10000) / 100}
		/>
	);
}
