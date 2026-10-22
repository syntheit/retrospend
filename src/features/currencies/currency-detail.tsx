"use client";

import { getCurrencyName } from "@retrospend/domain/currency-format";
import { currencyName } from "@retrospend/domain/currency-names";
import { useLocale, useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import { Notice } from "~/components/ui/notice";
import { useRateLabel } from "~/features/wealth/sheets/rate-type-chips";
import { ConvertBlock } from "./convert-block";
import { StarButton } from "./star-button";
import type { CurrenciesView, CurrencyRow } from "./types";

export function useCurrencyName() {
	const locale = useLocale();
	return (code: string) => currencyName(code, locale, getCurrencyName(code));
}

/**
 * The selected currency: its prices per rate type (the default marked), the
 * default for new expenses, and the converter. A currency with no rate says
 * so and names the accounts it leaves out.
 */
export function CurrencyDetail({
	view,
	row,
	onFavorite,
}: {
	view: CurrenciesView;
	row: CurrencyRow;
	onFavorite: (on: boolean) => void;
}) {
	const t = useTranslations("currenciesPage");
	const name = useCurrencyName();
	const label = useRateLabel();
	const { short } = useRowDates();
	const priced = row.types.length > 0;
	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-start gap-2">
				<div className="min-w-0 flex-1">
					<div className="text-fg text-section font-semibold">
						{name(row.code)}
					</div>
					<div className="text-fg-3 text-meta">
						{priced && view.updated
							? t("detail.sub", {
									code: row.code,
									home: view.home,
									date: short(view.updated),
								})
							: row.code}
					</div>
				</div>
				<StarButton onToggle={onFavorite} row={row} />
			</div>
			{priced ? null : (
				<div className="flex flex-col gap-2">
					<Notice tone="attention">
						{t("detail.noRate", { code: row.code })}
					</Notice>
					{row.usedBy.length ? (
						<p className="text-fg-3 text-meta">
							{t("detail.usedBy", { names: row.usedBy.join(", ") })}
						</p>
					) : null}
				</div>
			)}
			{priced ? (
				<div>
					<div className="text-fg-2 text-small mb-1 font-semibold">
						{t("detail.rates")}
					</div>
					<dl>
						{row.types.map((type) => (
							<div
								className="border-line flex items-baseline justify-between gap-3 border-t py-2 first:border-t-0"
								key={type}
							>
								<dt className="text-body text-fg">
									{label(type)}
									{type === row.defaultType && row.types.length > 1 ? (
										<span className="text-fg-3 text-meta ml-2">
											{t("detail.default")}
										</span>
									) : null}
								</dt>
								<dd className="text-body">
									<Money missing="noRate" value={row.prices[type] ?? null} />
								</dd>
							</div>
						))}
					</dl>
				</div>
			) : null}
			{priced && row.types.length > 1 && row.defaultType ? (
				<div>
					<div className="text-fg-2 text-small mb-1 font-semibold">
						{t("detail.defaultTitle")}
					</div>
					<p className="text-body text-fg">{label(row.defaultType)}</p>
					{view.canSetDefault ? null : (
						<p className="text-fg-3 text-meta">{t("detail.defaultFixed")}</p>
					)}
				</div>
			) : null}
			{priced ? <ConvertBlock home={view.home} row={row} /> : null}
		</div>
	);
}
