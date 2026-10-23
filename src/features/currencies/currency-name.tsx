"use client";

import { useTranslations } from "next-intl";
import { IconTile } from "~/components/rows/row";
import { CryptoIcon } from "~/components/ui/crypto-icon";
import { CurrencyFlag } from "~/components/ui/currency-flag";
import { useRateLabel } from "~/features/wealth/sheets/rate-type-chips";
import { useCurrencyName } from "./currency-detail";
import type { CurrencyRow } from "./types";

/** The currency's identity: flag or coin, code, its name and default type. */
export function CurrencyLead({ row }: { row: CurrencyRow }) {
	return (
		<IconTile>
			{row.crypto ? (
				<CryptoIcon
					className="size-5 border-0 bg-transparent"
					currencyCode={row.code}
				/>
			) : (
				<CurrencyFlag className="size-5" currencyCode={row.code} />
			)}
		</IconTile>
	);
}

export function useCurrencySub() {
	const t = useTranslations("currenciesPage");
	const name = useCurrencyName();
	const label = useRateLabel();
	return (row: CurrencyRow) =>
		!row.types.length
			? t("subNoRate", { name: name(row.code) })
			: row.types.length > 1 && row.defaultType
				? t("subDefault", {
						name: name(row.code),
						type: label(row.defaultType),
					})
				: name(row.code);
}

export function CurrencyName({ row }: { row: CurrencyRow }) {
	const sub = useCurrencySub();
	return (
		<div className="flex min-w-0 items-center gap-3">
			<CurrencyLead row={row} />
			<div className="flex min-w-0 flex-col leading-snug">
				<span className="text-body text-fg font-semibold">{row.code}</span>
				<span
					className={
						row.types.length
							? "text-fg-3 text-meta truncate"
							: "text-attention-text text-meta truncate"
					}
				>
					{sub(row)}
				</span>
			</div>
		</div>
	);
}
