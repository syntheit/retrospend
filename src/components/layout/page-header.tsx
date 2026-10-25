import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

/**
 * PageHeader (R1): the title, at most one primary action and the overflow
 * menu. Optionally the faces of the people involved and one sub line, and
 * the PageTabs of sibling pages, which belong to the header. No tagline, no
 * helper paragraph. The Toolbar comes right after it, with nothing between.
 *
 * From md up the sub line sits under the title; on phones it runs under the
 * whole header row, full width (kit `.wsub`), so a back button and the
 * actions never squeeze it into a wrap. One element, placed by the grid.
 * Each lead part carries its own space, so a part hidden on this width
 * (a phone-only BackButton) leaves none.
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
	/** A BackButton or a cover thumb before the title. */
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
	const line = Boolean(faces || sub);
	return (
		<header className={cn("mb-4", className)} data-slot="page-header">
			<div className="grid min-h-10 grid-cols-[auto_minmax(0,1fr)_auto] items-center">
				{lead ? (
					<div className="col-start-1 row-start-1 flex items-center *:mr-3 md:row-span-2">
						{lead}
					</div>
				) : null}
				<h1 className="text-fg text-title col-start-2 row-start-1 truncate">
					{title}
				</h1>
				{line && (
					<div className="text-fg-3 text-small col-span-3 col-start-1 row-start-2 flex flex-wrap items-center gap-2 max-md:mt-1 md:col-span-1 md:col-start-2">
						{faces}
						{sub && <span>{sub}</span>}
					</div>
				)}
				{(primary || overflow) && (
					<div className="col-start-3 row-start-1 ml-3 flex shrink-0 items-center gap-2 md:row-span-2">
						{primary}
						{overflow}
					</div>
				)}
			</div>
			{tabs && <div className="mt-3">{tabs}</div>}
		</header>
	);
}
