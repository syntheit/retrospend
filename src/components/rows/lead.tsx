"use client";

import type { ComponentType, ReactNode } from "react";
import { Progress } from "~/components/ui/progress";
import { cn } from "~/lib/cn";

/**
 * A neutral lead tile: money moves, accounts, Needs you items. Takes a
 * lucide glyph, or an identity mark as children (a crypto coin).
 */
export function IconTile({
	icon: Icon,
	tone = "neutral",
	children,
}: {
	icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
	tone?: "neutral" | "attention";
	children?: ReactNode;
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
			{Icon ? <Icon className="size-4" strokeWidth={1.75} /> : children}
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
