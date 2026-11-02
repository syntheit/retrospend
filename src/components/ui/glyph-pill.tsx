"use client";

import type { ReactNode } from "react";
import { FilterChip } from "~/components/ui/chip";

/**
 * GlyphPill (composer design D): a choice pill that leads with
 * identity, a bare glyph in its color or a face, never a tile. Selected is
 * the brand border plus the brand soft fill. It is the composer's one
 * choice pill; the look is FilterChip's.
 */
export function GlyphPill({
	selected,
	lead,
	children,
	...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value"> & {
	selected: boolean;
	lead?: ReactNode;
}) {
	return (
		<FilterChip lead={lead} selected={selected} {...props}>
			{children}
		</FilterChip>
	);
}
