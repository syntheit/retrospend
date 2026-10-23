"use client";

import { fromMinor } from "@retrospend/domain/money-minor";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { formatMoney } from "~/components/money/format";
import { Money } from "~/components/money/money";
import { MoneyInput } from "~/components/money/money-input";
import { useDateFormat } from "~/components/pickers/use-date-format";
import { Button } from "~/components/ui/button";
import { FilterChip, FilterChips } from "~/components/ui/chip";
import { Input } from "~/components/ui/input";
import { api, type RouterOutputs } from "~/trpc/react";
import {
	FieldError,
	type MoneyDTO,
	RateLine,
	useRateTypeName,
	useSettled,
} from "../shared-ui";
import type { ExpenseDraft } from "./draft";

type Options = RouterOutputs["entry"]["rateOptions"];

export type RateState = {
	opts: Options | undefined;
	/** The pair has no rate at all and no custom rate stands in: saving is blocked. */
	missing: boolean;
	/** The type shown as picked (the default until one is picked). */
	type: string | null;
	picked: Options["options"][number] | null;
	/** An edit keeps its saved custom rate until the rate is touched. */
	keptCustom: boolean;
};

/** The rate strip's data: every type the pair offers, booked by the server as Save books it. */
export function useRateState(
	d: ExpenseDraft,
	home: string,
	askedMinor: number | null,
): RateState {
	const foreign = d.currency !== home;
	const query = useSettled(
		{
			currency: d.currency,
			date: d.date,
			amount: askedMinor
				? fromMinor({ minor: askedMinor, currency: d.currency })
				: undefined,
		},
		250,
	);
	const rates = api.entry.rateOptions.useQuery(query, {
		enabled: foreign,
		placeholderData: (prev) => prev,
	});
	const opts = foreign ? rates.data : undefined;
	const keptCustom = d.rateType === "custom" && !d.custom;
	const type = d.custom ? "custom" : (d.rateType ?? opts?.defaultType ?? null);
	return {
		opts,
		missing: foreign && !!opts?.missing && !d.custom && !keptCustom,
		type,
		picked: opts?.options.find((o) => o.rateType === type) ?? null,
		keptCustom,
	};
}

/**
 * Amount (R22) and, for a foreign amount, its rate: the chip ("Blue ARS
 * 1,468") opens the strip of the pair's types plus Custom; the home line
 * says what it counts as in your budget. A pair with no rate says so and
 * offers Enter rate; it never converts at 1.
 */
export function AmountField(p: {
	d: ExpenseDraft;
	home: string;
	shared: boolean;
	rate: RateState;
	/** A saved expense's booked home value, while its custom rate is kept. */
	bookedHome: MoneyDTO | null;
	showErrors: boolean;
	errors: { amount?: boolean; rate?: boolean };
	favorites?: readonly string[];
	onAmount: (text: string) => void;
	onCurrency: (code: string) => void;
	onRate: (type: string) => void;
	onCustom: () => void;
	onCustomText: (text: string) => void;
}) {
	const t = useTranslations("entry");
	const locale = useLocale();
	const name = useRateTypeName();
	const { label: dates } = useDateFormat();
	const { d, home, rate } = p;
	const foreign = d.currency !== home;
	const [open, setOpen] = useState(false);
	const { opts, picked } = rate;
	const noRate = foreign && !!opts?.missing;
	const chip = picked
		? `${name(picked.rateType)} ${formatMoney(picked.rate.value, { locale })}`
		: t("rate.custom");
	const home$ = picked?.home ?? (rate.keptCustom ? p.bookedHome : null);
	const canPick = foreign && !noRate && !p.shared;

	return (
		<div className="flex flex-col gap-2">
			<MoneyInput
				autoFocus={!d.editing}
				currency={d.currency}
				favoriteCurrencies={p.favorites}
				onChange={(text) => p.onAmount(text)}
				onCurrencyChange={
					d.editing?.source === "shared" ? undefined : p.onCurrency
				}
				rate={
					canPick
						? { label: chip, onClick: () => setOpen((x) => !x) }
						: undefined
				}
				showErrors={p.showErrors}
				value={d.amountText}
			/>
			{p.showErrors && p.errors.amount && !d.amountText ? (
				<FieldError text={t("expense.error.amount")} />
			) : null}
			{noRate && !d.custom ? (
				<div
					className="flex items-center gap-3 rounded-ctl bg-attention-bg p-3 text-body"
					role="status"
				>
					<span className="min-w-0 flex-1">
						{t("rate.missing", {
							currency: d.currency,
							date: dates.short(d.date),
						})}
					</span>
					<Button kind="secondary" onClick={p.onCustom} size="sm">
						{t("rate.enterRate")}
					</Button>
				</div>
			) : null}
			{canPick && (open || d.custom) && opts ? (
				<FilterChips className="max-md:flex-wrap">
					{opts.options.map((o) => (
						<FilterChip
							aria-label={
								opts.defaultType === o.rateType
									? `${name(o.rateType)}, ${t("rate.default", { currency: d.currency })}`
									: undefined
							}
							key={o.rateType}
							onClick={() => p.onRate(o.rateType)}
							selected={rate.type === o.rateType}
						>
							{name(o.rateType)} <Money value={o.rate.value} />
						</FilterChip>
					))}
					<FilterChip onClick={p.onCustom} selected={d.custom}>
						{t("rate.custom")}
					</FilterChip>
				</FilterChips>
			) : null}
			{foreign && d.custom ? (
				<div className="flex flex-wrap items-center gap-2 text-fg-2 text-small">
					<span>{t("rate.customRate", { currency: d.currency })}</span>
					<Input
						aria-label={t("rate.customAria", { home })}
						autoFocus
						className="w-32 text-right tabular-nums"
						inputMode="decimal"
						onChange={(e) => p.onCustomText(e.target.value)}
						placeholder={t("rate.enterRate")}
						value={d.customText}
					/>
					<span>{home}</span>
				</div>
			) : null}
			{p.showErrors && p.errors.rate ? (
				<FieldError text={t("expense.error.rate", { currency: d.currency })} />
			) : null}
			{foreign ? (
				<div className="flex flex-wrap items-baseline justify-between gap-2 text-small">
					<span className="text-fg-2">
						{p.shared ? t("rate.shareInBudget") : t("rate.inBudget")}
					</span>
					{home$ ? (
						<Money
							className="font-medium text-fg"
							figure="entry.home"
							value={home$}
						/>
					) : noRate && !d.custom ? (
						<span className="text-attention-text">{t("rate.needsRate")}</span>
					) : null}
				</div>
			) : null}
			{/* The rate is stated once: on the chip, or here for a shared expense (no chip). */}
			{picked && p.shared ? (
				<span className="text-fg-3 text-meta">
					<RateLine rate={picked.rate} type={picked.rateType} />
					{` · ${dates.short(d.date)}`}
				</span>
			) : null}
			{foreign && p.shared ? (
				<span className="text-fg-3 text-meta">{t("rate.sharedFixed")}</span>
			) : null}
		</div>
	);
}
