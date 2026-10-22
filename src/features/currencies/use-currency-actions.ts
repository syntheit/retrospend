"use client";

import { formatMoney } from "@retrospend/domain/format";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import type { CurrencyTarget } from "~/components/actions/registry";
import type { ActionHandlers } from "~/components/actions/types";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";
import type { CurrenciesView, CurrencyRow } from "./types";

export const targetOf = (row: CurrencyRow): CurrencyTarget => ({
	id: row.code,
	name: row.code,
	favorite: row.favorite,
	hasRate: row.types.length > 0,
	crypto: row.crypto,
});

/**
 * The currency registry's handlers: convert (select), favorites through
 * today's exchange rate favorites (a currency is a favorite when any of its
 * rate rows is), copy the default price, and the rate history on xe.com.
 */
export function useCurrencyActions(
	view: CurrenciesView,
	select: (code: string) => void,
) {
	const t = useTranslations("currenciesPage");
	const locale = useLocale();
	const toast = useToast();
	const router = useRouter();
	const toggle = api.preferences.toggleFavoriteExchangeRate.useMutation();
	const byCode = useMemo(
		() => new Map(view.rows.map((r) => [r.code, r])),
		[view.rows],
	);

	const setFavorite = async (row: CurrencyRow, on: boolean) => {
		const ids = on ? (row.rateId ? [row.rateId] : []) : row.favoriteIds;
		if (!ids.length) return;
		try {
			for (const id of ids) await toggle.mutateAsync({ exchangeRateId: id });
			router.refresh();
			toast.saved(
				on
					? t("toast.favorited", { code: row.code })
					: t("toast.unfavorited", { code: row.code }),
			);
		} catch {
			toast.failed(t("toast.failed"));
		}
	};

	const handlers: ActionHandlers<CurrencyTarget> = {
		convert: (x) => select(x.id),
		favorite: (x) => {
			const row = byCode.get(x.id);
			if (row?.rateId) return setFavorite(row, true);
		},
		unfavorite: (x) => {
			const row = byCode.get(x.id);
			if (row) return setFavorite(row, false);
		},
		copy: (x) => {
			const row = byCode.get(x.id);
			const price = row?.defaultType ? row.prices[row.defaultType] : null;
			if (!row || !price) return;
			const text = formatMoney(price, { locale, display: "none" }) ?? "";
			void navigator.clipboard
				?.writeText(text)
				.then(() => toast.info(t("toast.copied", { rate: text })))
				.catch(() => toast.failed(t("toast.failed")));
		},
		history: (x) => {
			window.open(
				`https://www.xe.com/currencycharts/?from=${encodeURIComponent(x.id)}&to=${encodeURIComponent(view.home)}`,
				"_blank",
				"noopener,noreferrer",
			);
		},
	};

	return { handlers, setFavorite };
}
