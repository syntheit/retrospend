"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatMoney } from "~/components/money/format";
import { Money } from "~/components/money/money";
import { MoneyInput, MoneyInputRow } from "~/components/money/money-input";
import { useDateFormat } from "~/components/pickers/use-date-format";
import { FieldError, useRateTypeName } from "../shared-ui";
import type { useIncome } from "./use-income";

/**
 * The income amount, the same field as Add expense (owner 4G review): flag
 * and code on the chip, a foreign amount's rate types side by side, then
 * what it counts as in the home currency. No rate: it says so, never 1.
 */
export function IncomeAmount({
	x,
	home,
	tried,
}: {
	x: ReturnType<typeof useIncome>;
	home: string;
	tried: boolean;
}) {
	const t = useTranslations("entry");
	const name = useRateTypeName();
	const locale = useLocale();
	const { label: dates } = useDateFormat();
	const { d, rates } = x;
	const picked = rates?.options.find((o) => o.rateType === x.rateType) ?? null;
	const missing = x.foreign && !!rates?.missing;
	return (
		<>
			<MoneyInput
				autoFocus
				currency={d.currency}
				home={
					x.foreign
						? {
								currency: home,
								label: t("income.countsAs"),
								value: picked?.home ? (
									<Money figure="entry.income.home" value={picked.home} />
								) : missing ? (
									<span className="text-attention-text">
										{t("rate.needsRate")}
									</span>
								) : null,
							}
						: undefined
				}
				label={x.foreign ? t("income.received") : undefined}
				onChange={x.setAmount}
				onCurrencyChange={x.setCurrency}
				rates={
					x.foreign && rates && !missing
						? {
								label: t("rate.label"),
								value: x.rateType,
								options: rates.options.map((o) => ({
									value: o.rateType,
									label: name(o.rateType),
									rate: <Money value={o.rate.value} />,
									home: o.home ? <Money value={o.home} /> : undefined,
									ariaLabel: `${name(o.rateType)} ${formatMoney(o.rate.value, { locale })}`,
								})),
								onChange: (rateType) => x.set({ rateType }),
							}
						: undefined
				}
				rows={
					missing ? (
						<MoneyInputRow tone="attention">
							{t("rate.missing", {
								currency: d.currency,
								date: dates.short(d.date),
							})}
						</MoneyInputRow>
					) : null
				}
				showErrors={tried}
				value={d.amountText}
			/>
			{tried && x.errors.amount && !d.amountText ? (
				<FieldError text={t("income.error.amount")} />
			) : null}
			{tried && x.errors.rate ? (
				<FieldError text={t("income.error.rate", { currency: d.currency })} />
			) : null}
		</>
	);
}
