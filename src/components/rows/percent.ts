"use client";

import { useFormatter } from "next-intl";
import { useCallback } from "react";
import type { Basis } from "./types";

/**
 * Formats a share the server sent in hundredths of a percent (R9) in the page
 * locale: 1834 is "18.3%". The division only moves the unit for the
 * formatter; the value itself is never recomputed.
 */
export function usePercent() {
	const format = useFormatter();
	return useCallback(
		(basis: Basis, o?: { signed?: boolean; digits?: number }) =>
			format.number(basis / 10000, {
				style: "percent",
				maximumFractionDigits: o?.digits ?? 1,
				signDisplay: o?.signed ? "exceptZero" : "auto",
			}),
		[format],
	);
}
