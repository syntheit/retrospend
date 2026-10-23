"use client";

import { useTranslations } from "next-intl";
import { type PageTab, PageTabs } from "~/components/ui/page-tabs";
import { entryOf, hrefOf } from "~/lib/nav";

export type ActivityTabId = "expenses" | "recurring" | "insights";

/**
 * Activity's sibling pages as underline tabs (R21): Expenses, Recurring,
 * Insights. A tab shows once its page ships (SHIPPED_ROUTES), so the header
 * never links a page that is not there yet.
 */
export function ActivityTabs({ current }: { current: ActivityTabId }) {
	const t = useTranslations("activity.tabs");
	const tabs: PageTab[] = [
		{ id: "expenses", label: t("expenses"), href: "/activity" },
		{
			id: "recurring",
			label: t("recurring"),
			href: hrefOf(entryOf("recurring")) ?? "",
		},
		{
			id: "insights",
			label: t("insights"),
			href: hrefOf(entryOf("insights")) ?? "",
		},
	];
	return (
		<PageTabs
			current={current}
			items={tabs.filter((tab) => tab.href.startsWith("/activity"))}
		/>
	);
}
