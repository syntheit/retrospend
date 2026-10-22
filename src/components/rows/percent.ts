"use client";

import { formatPercent } from "@retrospend/domain/format-percent";
import { useLocale } from "next-intl";
import { useCallback } from "react";
import type { Basis } from "./types";

/**
 * Formats a share the server sent in hundredths of a percent (R9) through
 * the domain's percent formatter, in the page locale: 1834 is "18.3%".
 */
export function usePercent() {
	const locale = useLocale();
	return useCallback(
		(basis: Basis, o?: { signed?: boolean; digits?: 0 | 1 | 2 }) =>
			formatPercent(basis, {
				locale,
				digits: o?.digits ?? 1,
				sign: o?.signed ? "exceptZero" : "auto",
			}),
		[locale],
	);
}
