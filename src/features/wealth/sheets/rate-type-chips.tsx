"use client";

import { useTranslations } from "next-intl";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { rateTypeLabel } from "../rate-type-label";

/**
 * The rate types the server has for a currency, one chip each; the chosen
 * one is selected. Shown only when there is a choice. Rates themselves stay
 * on the server: the chips name the type, the server values the account.
 */
export function RateTypeChips({
	types,
	value,
	onChange,
}: {
	types: string[];
	value: string | null;
	onChange: (type: string) => void;
}) {
	const t = useTranslations("wealthPage.sheets");
	const label = useRateLabel();
	if (types.length < 2) return null;
	return (
		<div className="flex flex-col gap-2">
			<span className="text-fg-2 text-small">{t("valuedAtLabel")}</span>
			<FilterChips label={t("valuedAtLabel")}>
				{types.map((type) => (
					<FilterChip
						key={type}
						onClick={() => onChange(type)}
						selected={type === value}
					>
						{label(type)}
					</FilterChip>
				))}
			</FilterChips>
		</div>
	);
}

export function useRateLabel() {
	const t = useTranslations("wealthPage.rateTypes");
	return (type: string) => rateTypeLabel(type, (k) => (t.has(k) ? t(k) : null));
}
