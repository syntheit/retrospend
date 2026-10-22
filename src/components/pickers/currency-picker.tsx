"use client";

import { currencyName } from "@retrospend/domain/currency-names";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { CurrencyFlag } from "~/components/ui/currency-flag";
import { CRYPTO_CURRENCIES, CURRENCIES } from "~/lib/currencies";
import { PickerGroup, PickerItem, PickerList } from "./picker-list";

export type PickerCurrency = { id: string; name: string };

/** Every fiat currency, then crypto, from the one currencies table. */
export const ALL_CURRENCIES: readonly PickerCurrency[] = [
	...Object.values(CURRENCIES),
	...Object.values(CRYPTO_CURRENCIES),
].map((c) => ({ id: c.code, name: c.name }));

export type CurrencyPickerProps = {
	value: string | null;
	onChange: (code: string) => void;
	/** The user's favorites (preferences.getFavoriteCurrencies), in their order. */
	favorites?: readonly string[];
	/** Recently used, newest first; favorites are not repeated here. */
	recents?: readonly string[];
	currencies?: readonly PickerCurrency[];
};

/** Favorites, then recents, then the rest; each code appears once. */
export function currencyGroups<C extends PickerCurrency>(
	all: readonly C[],
	favorites: readonly string[] = [],
	recents: readonly string[] = [],
) {
	const byId = new Map(all.map((c) => [c.id, c]));
	const pick = (ids: readonly string[], taken: Set<string>) =>
		ids
			.filter((id) => !taken.has(id) && byId.has(id) && taken.add(id))
			.map((id) => byId.get(id) as C);
	const taken = new Set<string>();
	const fav = pick(favorites, taken);
	const recent = pick(recents, taken);
	return { fav, recent, rest: all.filter((c) => !taken.has(c.id)) };
}

/**
 * CurrencyPicker: find a currency by code or by its name in the reader's
 * language (or in English); favorites and recents first, a flag (or the
 * coin glyph) as identity.
 */
export function CurrencyPicker({
	value,
	onChange,
	favorites,
	recents,
	currencies = ALL_CURRENCIES,
}: CurrencyPickerProps) {
	const t = useTranslations("pickers.currency");
	const locale = useLocale();
	const named = useMemo(
		() =>
			currencies.map((c) => ({
				...c,
				english: c.name,
				name: currencyName(c.id, locale, c.name),
			})),
		[currencies, locale],
	);
	const groups = currencyGroups(named, favorites, recents);
	const item = (c: (typeof named)[number]) => (
		<PickerItem
			key={c.id}
			keywords={[c.id, c.name, c.english]}
			lead={<CurrencyFlag className="size-4" currencyCode={c.id} />}
			onSelect={() => onChange(c.id)}
			selected={c.id === value}
			selectedLabel={t("selected")}
			value={c.id}
		>
			<span className="font-medium">{c.id}</span>{" "}
			<span className="text-fg-2">{c.name}</span>
		</PickerItem>
	);
	return (
		<PickerList empty={t("empty")} label={t("label")} placeholder={t("find")}>
			{groups.fav.length > 0 ? (
				<PickerGroup heading={t("favorites")}>
					{groups.fav.map(item)}
				</PickerGroup>
			) : null}
			{groups.recent.length > 0 ? (
				<PickerGroup heading={t("recent")}>
					{groups.recent.map(item)}
				</PickerGroup>
			) : null}
			<PickerGroup heading={t("all")}>{groups.rest.map(item)}</PickerGroup>
		</PickerList>
	);
}
