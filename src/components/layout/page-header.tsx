import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

/**
 * PageHeader (R1): the title, at most one primary action and the overflow
 * menu. Optionally the faces of the people involved and one sub line, and
 * the PageTabs of sibling pages, which belong to the header. No tagline, no
 * helper paragraph. The Toolbar comes right after it, with nothing between.
 */
export function PageHeader({
	title,
	lead,
	faces,
	sub,
	primary,
	overflow,
	tabs,
	className,
}: {
	title: ReactNode;
	/** A back link or a cover thumb before the title. */
	lead?: ReactNode;
	/** A FaceStack of the people involved. */
	faces?: ReactNode;
	/** One short line (dates, a count). */
	sub?: ReactNode;
	/** The one primary Button. */
	primary?: ReactNode;
	/** The ⋯ menu (an icon-only ghost Button with an aria-label). */
	overflow?: ReactNode;
	/** PageTabs. */
	tabs?: ReactNode;
	className?: string;
}) {
	return (
		<header className={cn("mb-4", className)} data-slot="page-header">
			<div className="flex min-h-10 items-center gap-3">
				{lead}
				<div className="min-w-0 flex-1">
					<h1 className="truncate text-fg text-title">{title}</h1>
					{(faces || sub) && (
						<div className="flex flex-wrap items-center gap-2 text-fg-3 text-small">
							{faces}
							{sub && <span>{sub}</span>}
						</div>
					)}
				</div>
				{(primary || overflow) && (
					<div className="flex shrink-0 items-center gap-2">
						{primary}
						{overflow}
					</div>
				)}
			</div>
			{tabs && <div className="mt-3">{tabs}</div>}
		</header>
	);
}
