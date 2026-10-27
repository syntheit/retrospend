import { CRYPTO_CURRENCIES, CURRENCIES } from "@retrospend/domain/currencies";
import { getCountryCodeFromCurrency } from "@retrospend/domain/currency-country";
import { currencyName } from "@retrospend/domain/currency-names";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import { useLocale, useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Button } from "./Button";
import { FLAGS } from "./flags.generated";
import { Glyph } from "./Glyph";
import { PickerSheet } from "./PickerSheet";
import type { PickGroup } from "./pickGroups";

/** The flag of a currency's country in a circle; crypto and unknown codes get a coin. */
function CurrencyFlag({ code }: { code: string }) {
	const { color, size } = useTheme();
	const country = getCountryCodeFromCurrency(code);
	const xml = country ? FLAGS[country] : undefined;
	return xml ? (
		<SvgXml height={size.avatar.sm} width={size.avatar.sm} xml={xml} />
	) : (
		<View
			style={{
				width: size.avatar.sm,
				height: size.avatar.sm,
				borderRadius: size.avatar.sm / 2,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: color.raised,
			}}
		>
			<Glyph color={color.fg2} name="Coins" size={size.icon.phone} />
		</View>
	);
}

function englishName(code: string): string {
	return (CURRENCIES[code] ?? CRYPTO_CURRENCIES[code])?.name ?? code;
}

/**
 * Every place the app picks a currency: the code as a text button, and the
 * picker sheet behind it. Yours (home and default) and Recent come first, then
 * all, each with the flag the web shows and the code with its full name in
 * the reader's language; a search finds either (or the English name).
 */
export function CurrencyPicker({
	value,
	currencies,
	yours,
	recent,
	onChange,
}: {
	value: string;
	/** Every currency to choose from. */
	currencies: string[];
	/** Home and default currency, shown first. */
	yours: string[];
	/** Used lately, newest first. */
	recent: string[];
	onChange: (code: string) => void;
}) {
	const t = useTranslations("mobile.pickers");
	const locale = useLocale();
	const [open, setOpen] = useState(false);
	const groups = useMemo<PickGroup[]>(() => {
		const taken = new Set<string>();
		const known = new Set(currencies);
		const take = (codes: readonly string[]) =>
			codes.filter(
				(code) => known.has(code) && !taken.has(code) && taken.add(code),
			);
		const row = (code: string) => ({
			id: code,
			label: code,
			detail: currencyName(code, locale, englishName(code)),
			keywords: [englishName(code)],
			lead: <CurrencyFlag code={code} />,
			selected: code === value,
		});
		const first = take(yours);
		const lately = take(recent);
		return [
			{ key: "yours", heading: t("currency.yours"), rows: first.map(row) },
			{ key: "recent", heading: t("currency.recent"), rows: lately.map(row) },
			{
				key: "all",
				heading: t("currency.all"),
				rows: take(currencies).map(row),
			},
		];
	}, [currencies, yours, recent, locale, value, t]);

	return (
		<>
			<Button
				accessibilityLabel={t("currency.trigger", { code: value })}
				label={value}
				onPress={() => setOpen(true)}
				variant="text"
			/>
			<PickerSheet
				clear={t("clear")}
				empty={t("currency.empty")}
				find={t("currency.find")}
				groups={groups}
				onClose={() => setOpen(false)}
				onSelect={onChange}
				title={t("currency.title")}
				visible={open}
			/>
		</>
	);
}
