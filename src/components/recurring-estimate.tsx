"use client";

import { tryConvertAmount } from "@retrospend/domain/money";
import { toMinor } from "@retrospend/domain/money-minor";
import { useTranslations } from "next-intl";
import { formatMoney } from "~/components/money/format";
import { useMoneyLocale } from "~/components/money/use-money-locale";
import { useCurrency } from "~/hooks/use-currency";

/** What the amount is worth in the home currency, once both rates are known. */
export function CurrencyEstimate({
	amount,
	currency,
	homeCurrency,
	rate,
	isLoading,
}: {
	amount: number;
	currency: string;
	homeCurrency: string;
	rate?: number;
	isLoading: boolean;
}) {
	const t = useTranslations("recurring");
	const locale = useMoneyLocale();
	const { usdToHomeRate } = useCurrency();

	if (currency === homeCurrency || !amount) return null;
	if (isLoading)
		return <p className="text-muted-foreground text-xs">{t("calculating")}</p>;

	// No estimate until both rates are known (never assume 1)
	const estimation = tryConvertAmount(
		amount,
		currency,
		rate,
		homeCurrency,
		usdToHomeRate,
	);
	if (estimation === null) return null;

	return (
		<p className="fade-in slide-in-from-top-1 animate-in text-muted-foreground text-xs duration-(--t-row)">
			{t("estimated", {
				amount: formatMoney(
					{ minor: toMinor(estimation, homeCurrency), currency: homeCurrency },
					{ locale },
				),
			})}
		</p>
	);
}
