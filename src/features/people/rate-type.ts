"use client";

import { useTranslations } from "next-intl";
import { rateTypeLabel } from "~/features/wealth/rate-type-label";

/** A rate type's name (Blue, Official, MEP...); a type added later reads as its key, capitalized. */
export function useRateTypeName() {
	const t = useTranslations("peoplePage.rateTypes");
	return (type: string) => rateTypeLabel(type, (k) => (t.has(k) ? t(k) : null));
}
