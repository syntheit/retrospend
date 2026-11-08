import { CURRENCIES } from "@retrospend/domain/currencies";
import { currencyForLocale } from "@retrospend/domain/currency-country";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Label } from "~/components/ui/label";
import { CurrencyField } from "~/features/settings/preferences/currency-field";

// The browser's region suggests the home currency, the person can change it.
export function useHomeCurrency() {
	const [homeCurrency, setHomeCurrency] = useState("USD");
	useEffect(() => {
		const suggested = currencyForLocale(
			navigator.language,
			new Set(Object.keys(CURRENCIES)),
		);
		if (suggested) setHomeCurrency(suggested);
	}, []);
	return [homeCurrency, setHomeCurrency] as const;
}

export function HomeCurrencyField({
	value,
	onChange,
	disabled,
}: {
	value: string;
	onChange: (currency: string) => void;
	disabled: boolean;
}) {
	const t = useTranslations("auth");

	return (
		<div className="space-y-2">
			<Label htmlFor="homeCurrency">{t("homeCurrency")}</Label>
			<CurrencyField
				className="w-full"
				disabled={disabled}
				id="homeCurrency"
				label={t("homeCurrency")}
				onChange={onChange}
				value={value}
			/>
		</div>
	);
}
