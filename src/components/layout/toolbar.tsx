import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

/**
 * Toolbar (R1): one row under the header. Search where the list needs it,
 * then the filter chips and the Filter menu, then the view switch
 * (Segmented) at the end. Every control is h-ctl, so they share one height
 * and baseline (R31). Never two rows of the same kind of control (R7).
 */
export function Toolbar({
	search,
	children,
	end,
	label,
	className,
}: {
	/** An Input with a search glyph. */
	search?: ReactNode;
	/** FilterChip and FilterMenu, usually inside FilterChips. */
	children?: ReactNode;
	/** The view switch, last in the row. */
	end?: ReactNode;
	/** Accessible name of the region ("Filter expenses"). */
	label: string;
	className?: string;
}) {
	return (
		<div
			aria-label={label}
			className={cn("mb-4 flex flex-wrap items-center gap-2", className)}
			data-slot="toolbar"
			role="group"
		>
			{search}
			{children}
			{end && <div className="ml-auto flex items-center">{end}</div>}
		</div>
	);
}
