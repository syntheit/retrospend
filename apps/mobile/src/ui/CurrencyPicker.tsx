import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "use-intl";
import { usePinnedCurrencies } from "@/features/currencies/useCurrencies";
import {
	countryNamesOf,
	englishCurrencyName as englishName,
	localCurrencyName,
} from "@/lib/currency-names";
import {
	recordRecentCurrency,
	useRecentCurrencies,
} from "@/lib/recent-currencies";
import { Chip } from "./Chip";
import { CurrencyFlag } from "./CurrencyFlag";
import { currencySections, mergeRecent } from "./currencySections";
import { PickerSheet } from "./PickerSheet";
import type { PickGroup } from "./pickGroups";

const NONE: string[] = [];

/**
 * The one place the app picks a currency: a trigger pill (flag, code,
 * chevron) and the picker sheet behind it. The sheet lists Pinned (the stars
 * on the Currencies screen), Your currencies, Recent, then Fiat and Crypto,
 * each row with its flag (a coin for crypto), the code and the name in the
 * reader's language. A search finds the code, the name in either language or
 * the country, best matches first.
 */
export function CurrencyPicker({
	value,
	currencies,
	yours = NONE,
	recent = NONE,
	label,
	onChange,
}: {
	value: string;
	/** Every currency to choose from. */
	currencies: string[];
	/** Home and default currency, shown after the pinned ones. */
	yours?: string[];
	/** Used lately on this screen's side, newest first; the picks made here are added. */
	recent?: string[];
	/** What is being chosen ("Home currency"), spoken before the code. */
	label?: string;
	onChange: (code: string) => void;
}) {
	const t = useTranslations("mobile.pickers");
	const locale = useLocale();
	const [open, setOpen] = useState(false);
	const pinned = usePinnedCurrencies();
	const picked = useRecentCurrencies();
	const groups = useMemo<PickGroup[]>(() => {
		const sections = currencySections({
			currencies,
			pinned,
			yours,
			recent: mergeRecent(picked, recent),
		});
		const row = (code: string) => ({
			id: code,
			label: code,
			detail: localCurrencyName(code, locale),
			keywords: [englishName(code), ...countryNamesOf(code, locale)],
			lead: <CurrencyFlag code={code} />,
			selected: code === value,
		});
		const group = (key: keyof typeof sections, heading: string): PickGroup => ({
			key,
			heading,
			rows: sections[key].map(row),
			ranked: true,
		});
		return [
			group("pinned", t("currency.pinned")),
			group("yours", t("currency.yours")),
			group("recent", t("currency.recent")),
			group("fiat", t("currency.fiat")),
			group("crypto", t("currency.crypto")),
		];
	}, [currencies, pinned, yours, picked, recent, locale, value, t]);

	return (
		<>
			<Chip
				accessibilityLabel={
					label ? `${label}, ${value}` : t("currency.trigger", { code: value })
				}
				label={value}
				leading={<CurrencyFlag code={value} small />}
				onPress={() => setOpen(true)}
				variant="trigger"
			/>
			<PickerSheet
				clear={t("clear")}
				empty={t("currency.empty")}
				find={t("currency.find")}
				groups={groups}
				onClose={() => setOpen(false)}
				onSelect={(code) => {
					recordRecentCurrency(code);
					onChange(code);
				}}
				title={label ?? t("currency.title")}
				visible={open}
			/>
		</>
	);
}
