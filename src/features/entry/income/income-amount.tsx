"use client";

import {
	type RateDirection,
	rateDirection,
} from "@retrospend/domain/rate-format";
import { PencilIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Money } from "~/components/money/money";
import {
	MoneyInput,
	MoneyInputRow,
	type MoneyRates,
} from "~/components/money/money-input";
import { useRateFormat } from "~/components/money/use-rate-format";
import { useDateFormat } from "~/components/pickers/use-date-format";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { FieldError, useRateTypeName } from "../shared-ui";
import type { useIncome } from "./use-income";

type Income = ReturnType<typeof useIncome>;

/**
 * The income amount, the same field as Add expense: flag and code on the
 * chip, a foreign amount's rate types side by side with Custom last, then
 * what it counts as in the home currency, booked by the server. A pair with
 * no rate says so and offers Enter rate; it never converts at 1.
 */
export function IncomeAmount({
	x,
	home,
	tried,
}: {
	x: Income;
	home: string;
	tried: boolean;
}) {
	const t = useTranslations("entry");
	const { d, rates } = x;
	const custom = x.foreign && d.custom;
	const picked = custom
		? (rates?.custom ?? null)
		: (rates?.options.find((o) => o.rateType === x.rateType) ?? null);
	const noRate = x.foreign && !!rates?.missing;
	const strip = useIncomeRates(x, x.foreign && !noRate);
	// The pair reads the way its rate reads: the typed number is the >= 1 one.
	const dir = rateDirection(
		d.currency,
		home,
		rates?.options[0]?.rate.rate ?? null,
	);
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
								) : noRate && !custom ? (
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
				rates={strip}
				rows={<IncomeRateRows dir={dir} noRate={noRate} x={x} />}
				showErrors={tried}
				value={d.amountText}
			/>
			{tried && x.errors.amount && !d.amountText ? (
				<FieldError text={t("income.error.amount")} />
			) : null}
			{tried && x.errors.rate ? (
				<FieldError text={t("expense.error.rate", { currency: d.currency })} />
			) : null}
		</>
	);
}

/** The strip: the pair's types with their rates and bookings, then Custom (never one button alone). */
function useIncomeRates(x: Income, show: boolean): MoneyRates | undefined {
	const t = useTranslations("entry");
	const fmt = useRateFormat();
	const name = useRateTypeName();
	const rates = x.rates;
	if (!show || !rates) return undefined;
	const row = fmt.row(
		x.d.currency,
		rates.homeCurrency,
		rates.options.map((o) => o.rate.rate),
	);
	return {
		label: t("rate.label"),
		...(row ? { unit: `${row.unit} =` } : {}),
		value: x.rateType,
		options: [
			...rates.options.map((o, i) => ({
				value: o.rateType,
				label: name(o.rateType),
				rate: row?.values[i] ?? undefined,
				home: o.home ? <Money value={o.home} /> : undefined,
				ariaLabel: fmt.withType(name(o.rateType), o.rate) ?? name(o.rateType),
			})),
			{
				value: "custom",
				label: t("rate.custom"),
				rate: <PencilIcon aria-hidden="true" className="size-4" />,
			},
		],
		onChange: (v) =>
			v === "custom"
				? x.pickCustom(
						rateDirection(
							x.d.currency,
							rates.homeCurrency,
							rates.options[0]?.rate.rate ?? null,
						).flipped,
					)
				: x.pickRate(v),
	};
}

/** Inside the field under the strip: no rate (Enter rate), the typed rate. */
function IncomeRateRows({
	x,
	dir,
	noRate,
}: {
	x: Income;
	dir: RateDirection;
	noRate: boolean;
}) {
	const t = useTranslations("entry");
	const { label: dates } = useDateFormat();
	const { d } = x;
	if (!x.foreign) return null;
	return (
		<>
			{noRate && !d.custom ? (
				<MoneyInputRow tone="attention">
					<span className="min-w-0 flex-1">
						{t("rate.missing", {
							currency: d.currency,
							date: dates.short(d.date),
						})}
					</span>
					<Button
						kind="secondary"
						onClick={() => x.pickCustom(dir.flipped)}
						size="sm"
					>
						{t("rate.enterRate")}
					</Button>
				</MoneyInputRow>
			) : null}
			{d.custom ? (
				<MoneyInputRow>
					<span>{t("rate.customRate", { currency: dir.base })}</span>
					<Input
						aria-label={t("rate.customAria", { home: dir.quote })}
						autoFocus
						className="h-ctl-sm w-32 text-right tabular-nums"
						inputMode="decimal"
						onChange={(e) => x.setCustomText(e.target.value, dir.flipped)}
						placeholder={t("rate.enterRate")}
						value={d.customText}
					/>
					<span>{dir.quote}</span>
				</MoneyInputRow>
			) : null}
		</>
	);
}
