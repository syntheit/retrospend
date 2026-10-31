"use client";

import { usePathname } from "next/navigation";

/**
 * Destinations whose pages are tabs of one another. Moving between them
 * swaps the content at once: only the tab indicator moves, so the page does
 * not play its entrance again.
 */
const TAB_GROUPS = ["/activity"];

/** The key a page enters under: the destination for tab siblings, else its path. */
export function pageKey(pathname: string): string {
	return (
		TAB_GROUPS.find((g) => pathname === g || pathname.startsWith(`${g}/`)) ??
		pathname
	);
}

export function PageTransition({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();

	return (
		<div
			key={pageKey(pathname)}
			className="flex flex-1 flex-col overflow-hidden"
			style={{
				animation: "page-enter 200ms cubic-bezier(0.25, 0.1, 0.25, 1) both",
			}}
		>
			{children}
		</div>
	);
}
