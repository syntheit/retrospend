"use client";

import { formatMoney } from "@retrospend/domain/format";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useRef, useTransition } from "react";
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

	// One toggle at a time: a double click would flip the favorite twice.
	// Until the refreshed view arrives the row still shows the old state, so
	// the refresh counts as busy too.
	const busy = useRef(false);
	const [refreshing, startRefresh] = useTransition();
	const setFavorite = async (row: CurrencyRow, on: boolean) => {
		const ids = on ? (row.rateId ? [row.rateId] : []) : row.favoriteIds;
		if (!ids.length || busy.current || refreshing) return;
		busy.current = true;
		try {
			for (const id of ids) await toggle.mutateAsync({ exchangeRateId: id });
			startRefresh(() => router.refresh());
			toast.saved(
				on
					? t("toast.favorited", { code: row.code })
					: t("toast.unfavorited", { code: row.code }),
			);
		} catch {
			toast.failed(t("toast.failed"));
		} finally {
			busy.current = false;
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

	return {
		handlers,
		setFavorite,
		favoriteBusy: toggle.isPending || refreshing,
	};
}
