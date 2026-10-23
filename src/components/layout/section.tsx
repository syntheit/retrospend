import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

/**
 * Section (R2): flat. A heading (16/600) with an optional count, then at the
 * end of the heading row either one link ("See all") or one control (a
 * Segmented, Add person), the content, then space (32 between sections). No
 * border, no card: a border only goes around something you act on, inside
 * the content.
 */
export function Section({
	title,
	count,
	action,
	end,
	children,
	id,
	className,
}: {
	title: ReactNode;
	/** How many things the section holds, in fg-3. */
	count?: number;
	/** One link to the full list ("See all"). */
	action?: { label: string; href: string };
	/** One control at the end of the heading row, instead of the link. */
	end?: ReactNode;
	children: ReactNode;
	id?: string;
	className?: string;
}) {
	const headingId = id ? `${id}-title` : undefined;
	return (
		<section
			aria-labelledby={headingId}
			className={cn("mt-8 first:mt-0", className)}
			data-slot="section"
			id={id}
		>
			<div
				className={cn(
					"mb-2 flex gap-2",
					end ? "min-h-ctl items-center gap-3" : "items-baseline",
				)}
			>
				<h2 className="text-fg text-section flex-1" id={headingId}>
					{title}
					{count != null && (
						<span className="text-fg-3 ml-2 font-normal tabular-nums">
							{count}
						</span>
					)}
				</h2>
				{end ??
					(action && (
						<Link
							className="rounded-ctl text-accent-strong text-small focus-visible:outline-brand can-hover:hover:underline inline-flex items-center gap-1 font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
							href={action.href}
						>
							{action.label}
							<ChevronRight aria-hidden="true" className="size-4" />
						</Link>
					))}
			</div>
			{children}
		</section>
	);
}
