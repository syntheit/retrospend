"use client";

import { useTranslations } from "next-intl";
import { type PageTab, PageTabs } from "~/components/ui/page-tabs";
import { entryOf } from "~/lib/nav";

export type ActivityTabId = "expenses" | "recurring" | "insights";

/**
 * Activity's sibling pages as underline tabs (R21): Expenses, Recurring,
 * Insights.
 */
export function ActivityTabs({ current }: { current: ActivityTabId }) {
	const t = useTranslations("activity.tabs");
	const tabs: PageTab[] = [
		{ id: "expenses", label: t("expenses"), href: "/activity" },
		{ id: "recurring", label: t("recurring"), href: entryOf("recurring").href },
		{ id: "insights", label: t("insights"), href: entryOf("insights").href },
	];
	return <PageTabs current={current} items={tabs} />;
}
