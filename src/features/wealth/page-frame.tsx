"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Tip } from "~/components/ui/tooltip";

/**
 * The scrolling column a v2 page sits in inside the shell's main: the kit's
 * `.page` (1120 max, gutter sides). `data-ui="v2"` marks the page for the
 * e2e audits. The kit has no page container yet, so the Wealth and
 * Currencies pages share this one (reported as a kit gap).
 */
export function PageFrame({
	children,
	label,
}: {
	children: ReactNode;
	/** Names the page for the audits ("wealth"). */
	label: string;
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
			<div
				className="px-gutter mx-auto w-full max-w-280 pt-6 pb-12"
				data-page={label}
				data-ui="v2"
			>
				{children}
			</div>
		</div>
	);
}

/**
 * Phones push Wealth (from Home) and Currencies (from Wealth), so their
 * header leads with a back button naming where it goes. Button asChild
 * cannot wrap a link yet (the kit's spinner child), so it navigates.
 */
export function BackButton({ href, label }: { href: string; label: string }) {
	const router = useRouter();
	return (
		<Tip content={label}>
			<Button
				aria-label={label}
				className="md:hidden"
				icon
				kind="ghost"
				onClick={() => router.push(href)}
			>
				<ChevronLeft />
			</Button>
		</Tip>
	);
}
