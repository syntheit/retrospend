import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "~/lib/cn";

/**
 * Section (R2): flat. A heading (16/600) with an optional count and one
 * link, the content, then space (32 between sections). No border, no card:
 * a border only goes around something you act on, inside the content.
 */
export function Section({
	title,
	count,
	action,
	children,
	id,
	className,
}: {
	title: ReactNode;
	/** How many things the section holds, in fg-3. */
	count?: number;
	/** One link to the full list ("See all"). */
	action?: { label: string; href: string };
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
			<div className="mb-2 flex items-baseline gap-2">
				<h2 className="flex-1 text-fg text-section" id={headingId}>
					{title}
					{count != null && (
						<span className="ml-2 font-normal text-fg-3 tabular-nums">
							{count}
						</span>
					)}
				</h2>
				{action && (
					<Link
						className="inline-flex items-center gap-1 rounded-ctl font-medium text-accent-strong text-small focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 can-hover:hover:underline"
						href={action.href}
					>
						{action.label}
						<ChevronRight aria-hidden="true" className="size-4" />
					</Link>
				)}
			</div>
			{children}
		</section>
	);
}
