import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Tip } from "~/components/ui/tooltip";
import { cn } from "~/lib/cn";

/**
 * PageFrame: the scrolling column a v2 page sits in inside the shell's main
 * (kit `.main` + `.page`): 1120 at most, centered, the gutter at the sides,
 * 24 above and 48 below. `data-ui="v2"` and `data-page` mark the page for
 * the e2e audits. With `fill`, from md up the column is as tall as the
 * window and its last child (a list) takes the height that is left.
 */
export function PageFrame({
	children,
	label,
	fill,
	contain = false,
}: {
	children: ReactNode;
	/** Names the page for the audits ("wealth"); a loading fallback leaves it out. */
	label?: string;
	/** Desktop: the content runs to the bottom of the window. */
	fill?: boolean;
	/**
	 * Desktop only: the page does not scroll, the one list or table in it
	 * does, inside its own region under the header and toolbar. A phone
	 * scrolls the page as usual.
	 */
	contain?: boolean;
}) {
	return (
		<div
			className={cn(
				"flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto",
				contain && "md:overflow-y-hidden",
			)}
		>
			<div
				className={cn(
					"px-gutter mx-auto w-full max-w-280 pt-6 pb-12",
					fill && "md:flex md:flex-1 md:flex-col md:pb-6",
					contain && "md:flex md:min-h-0 md:flex-1 md:flex-col md:pb-6",
				)}
				data-page={label}
				data-ui={label ? "v2" : undefined}
			>
				{children}
			</div>
		</div>
	);
}

/**
 * BackButton: the PageHeader lead on a pushed page (Person, Project, Wealth,
 * Currencies, Import). Phones only: desktop reaches the parent from the
 * sidebar. A link, named for where it goes, with its tooltip.
 */
export function BackButton({ href, label }: { href: string; label: string }) {
	return (
		<Tip content={label}>
			<Button asChild className="md:hidden" icon kind="ghost">
				<Link aria-label={label} href={href}>
					<ChevronLeft aria-hidden="true" />
				</Link>
			</Button>
		</Tip>
	);
}
