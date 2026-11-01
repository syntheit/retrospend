"use client";

import { useTranslations } from "next-intl";
import { useRateFormat } from "~/components/money/use-rate-format";
import type { ActivityRowDTO } from "~/server/services/expense-list/types";
import type { RateWord } from "./to-vm";

/**
 * A row's rate for the amount's tip: "Official · 1 USD = 1,545.20 ARS". The
 * type never shows without its number, so a row the server sent no rate for
 * says nothing (R8).
 */
export function useRateWord(): RateWord {
	const types = useTranslations("activity.rateTypes");
	const fmt = useRateFormat();
	return (row: ActivityRowDTO) => {
		if (!row.rateType || !row.rate || !row.home) return null;
		const name = types.has(row.rateType) ? types(row.rateType) : row.rateType;
		return fmt.typed(name, row.amount.currency, row.home.currency, row.rate);
	};
}
