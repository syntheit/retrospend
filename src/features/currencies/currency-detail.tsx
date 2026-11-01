"use client";

import { getCurrencyName } from "@retrospend/domain/currency-format";
import { currencyName } from "@retrospend/domain/currency-names";
import { useLocale, useTranslations } from "next-intl";
import { Section } from "~/components/layout/section";
import { Money } from "~/components/money/money";
import { useRowDates } from "~/components/rows/dates";
import { Notice } from "~/components/ui/notice";
import { useRateLabel } from "~/features/wealth/sheets/rate-type-chips";
import { ConvertBlock } from "./convert-block";
import { CurrencyExpenses } from "./currency-expenses";
import { RateHistory } from "./rate-history";
import { RateText } from "./rate-text";
import { sentenceName } from "./sentence-name";
import { StarButton } from "./star-button";
import type { CurrenciesView, CurrencyRow } from "./types";

function PriceText({
	value,
}: {
	value: CurrencyRow["prices"][string] | undefined;
}) {
	return value ? (
		<RateText price={value} />
	) : (
		<Money missing="noRate" value={null} />
	);
}

export function useCurrencyName() {
	const locale = useLocale();
	return (code: string) =>
		sentenceName(currencyName(code, locale, getCurrencyName(code)), locale);
}

/**
 * The open currency, in a dialog on desktop and a sheet on a phone: its
 * prices per rate type (the default marked), the price history, the
 * converter, and your expenses in it. A currency with no rate says so and
 * names the accounts it leaves out.
 */
export function CurrencyDetail({
	view,
	row,
	onFavorite,
	favoriteBusy,
}: {
	view: CurrenciesView;
	row: CurrencyRow;
	onFavorite: (on: boolean) => void;
	favoriteBusy: boolean;
}) {
	const t = useTranslations("currenciesPage");
	const name = useCurrencyName();
	const label = useRateLabel();
	const { short } = useRowDates();
	const priced = row.types.length > 0;
	return (
		<div className="flex flex-col gap-6 pb-4">
			<div className="flex items-start gap-2">
				<div className="min-w-0 flex-1">
					<div className="text-fg text-section font-semibold">
						{name(row.code)}
					</div>
					<div className="text-fg-3 text-meta">
						{priced && view.updated
							? t("detail.sub", {
									code: row.code,
									date: short(view.updated),
								})
							: row.code}
					</div>
				</div>
				<StarButton busy={favoriteBusy} onToggle={onFavorite} row={row} />
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
			<div className="grid gap-8 md:grid-cols-2">
				<div className="flex min-w-0 flex-col gap-8">
					{priced ? (
						<Section id="rates" title={t("detail.rates")}>
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
											{row.derived.includes(type) ? (
												<span className="text-fg-3 text-meta block">
													{t("derived", { home: view.home })}
												</span>
											) : null}
										</dt>
										<dd className="text-body">
											<PriceText value={row.prices[type]} />
										</dd>
									</div>
								))}
							</dl>
						</Section>
					) : null}
					{priced && row.types.length > 1 && row.defaultType ? (
						<Section id="default" title={t("detail.defaultTitle")}>
							<p className="text-body text-fg">{label(row.defaultType)}</p>
						</Section>
					) : null}
					{priced ? (
						<ConvertBlock home={view.home} key={row.code} row={row} />
					) : null}
				</div>
				<div className="flex min-w-0 flex-col gap-8">
					{priced ? <RateHistory code={row.code} key={row.code} /> : null}
					<CurrencyExpenses code={row.code} key={`x-${row.code}`} />
				</div>
			</div>
		</div>
	);
}
