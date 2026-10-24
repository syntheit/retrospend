"use client";

import { useTranslations } from "next-intl";
import type { MonthData } from "./use-month";

/**
 * The name of the To assign pool in the book's style: "Not planned yet" in
 * every style except Every dollar (owner 2026-10-22f). The server says which
 * (`toAssign.poolName`); this only turns it into words.
 */
export function usePoolName(month: MonthData | null): string {
	const t = useTranslations("budgetSheets.pool");
	return month?.toAssign.poolName === "TO_ASSIGN"
		? t("toAssign")
		: t("notPlannedYet");
}
