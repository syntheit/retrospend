"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
	lineTab,
	lineTabOn,
	TabCount,
	TabIndicator,
} from "~/components/ui/tabs";
import { cn } from "~/lib/cn";

export type PageTab = {
	id: string;
	href: string;
	label: string;
	/** A count after the label (Recurring 11), in fg-3. */
	count?: number;
};

/**
 * PageTabs (R21): underline tabs between sibling pages of one destination
 * (Activity: Expenses, Recurring). Real links with aria-current, part of the
 * page header. Put them in a shared layout so the indicator slides between
 * pages; switching panes inside one page is Tabs, switching a view of the
 * same data is Segmented.
 */
export function PageTabs({
	items,
	current,
	className,
}: {
	items: PageTab[];
	/** The id of the page being shown. */
	current: string;
	className?: string;
}) {
	const t = useTranslations("kit.tabs");
	return (
		<div data-slot="tabs">
			<nav
				aria-label={t("pages")}
				className={cn(
					"relative mb-4 flex items-stretch gap-6 overflow-x-auto border-line border-b [scrollbar-width:none]",
					className,
				)}
			>
				{items.map((item) => {
					const on = item.id === current;
					return (
						<Link
							aria-current={on ? "page" : undefined}
							className={cn(lineTab, on && lineTabOn)}
							href={item.href}
							key={item.id}
						>
							{item.label}
							{item.count != null && <TabCount n={item.count} />}
						</Link>
					);
				})}
				<TabIndicator />
			</nav>
		</div>
	);
}
