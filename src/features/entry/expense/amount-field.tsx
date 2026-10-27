"use client";

import { fromMinor } from "@retrospend/domain/money-minor";
import { PencilIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatMoney } from "~/components/money/format";
import { Money } from "~/components/money/money";
import {
	MoneyInput,
	MoneyInputRow,
	type MoneyRates,
} from "~/components/money/money-input";
import { useMoneyLocale } from "~/components/money/use-money-locale";
import { useDateFormat } from "~/components/pickers/use-date-format";
import { Button } from "~/components/ui/button";
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
			// A typed rate is booked by the server too, so the home row shows it.
			customRate: d.custom && d.customRate ? d.customRate : undefined,
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
		picked: d.custom
			? (opts?.custom ?? null)
			: (opts?.options.find((o) => o.rateType === type) ?? null),
		keptCustom,
	};
}

/**
 * Amount (R22) and, for a foreign amount, its conversion in the same field
 * (the flag-off form's strengths, owner 4G review): every rate type the
 * pair offers side by side with its rate, Custom last, then what it counts
 * as in your budget. A pair with no rate says so and offers Enter rate; it
 * never converts at 1.
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
	const { d, home, rate } = p;
	const foreign = d.currency !== home;
	const noRate = foreign && !!rate.opts?.missing;
	const home$ = rate.picked?.home ?? (rate.keptCustom ? p.bookedHome : null);
	const rates = useRateStrip(p, foreign && !noRate && !p.shared);

	return (
		<div className="flex flex-col gap-2">
			<MoneyInput
				autoFocus={!d.editing}
				currency={d.currency}
				favoriteCurrencies={p.favorites}
				home={
					foreign
						? {
								currency: home,
								label: p.shared ? t("rate.shareInBudget") : t("rate.inBudget"),
								value: home$ ? (
									<Money figure="entry.home" value={home$} />
								) : noRate && !d.custom ? (
									<span className="text-attention-text">
										{t("rate.needsRate")}
									</span>
								) : null,
							}
						: undefined
				}
				label={foreign && !p.shared ? t("rate.youSpent") : undefined}
				onChange={(text) => p.onAmount(text)}
				onCurrencyChange={
					d.editing?.source === "shared" ? undefined : p.onCurrency
				}
				operators
				rates={rates}
				rows={<RateRows {...p} noRate={noRate} />}
				showErrors={p.showErrors}
				value={d.amountText}
			/>
			{p.showErrors && p.errors.amount && !d.amountText ? (
				<FieldError text={t("expense.error.amount")} />
			) : null}
			{p.showErrors && p.errors.rate ? (
				<FieldError text={t("expense.error.rate", { currency: d.currency })} />
			) : null}
		</div>
	);
}

/** The strip's options: the server's types with their rates and bookings, then Custom. */
function useRateStrip(
	p: Parameters<typeof AmountField>[0],
	show: boolean,
): MoneyRates | undefined {
	const t = useTranslations("entry");
	const locale = useMoneyLocale();
	const name = useRateTypeName();
	const opts = p.rate.opts;
	if (!show || !opts) return undefined;
	return {
		label: t("rate.label"),
		value: p.d.custom ? "custom" : p.rate.type,
		options: [
			...opts.options.map((o) => ({
				value: o.rateType,
				label: name(o.rateType),
				rate: <Money value={o.rate.value} />,
				home: o.home ? <Money value={o.home} /> : undefined,
				ariaLabel: [
					`${name(o.rateType)} ${formatMoney(o.rate.value, { locale })}`,
					opts.defaultType === o.rateType
						? t("rate.default", { currency: p.d.currency })
						: null,
				]
					.filter(Boolean)
					.join(", "),
			})),
			{
				value: "custom",
				label: t("rate.custom"),
				rate: <PencilIcon aria-hidden="true" className="size-4" />,
			},
		],
		onChange: (v) => (v === "custom" ? p.onCustom() : p.onRate(v)),
	};
}

/** Inside the field under the strip: no rate, the custom rate, a shared expense's fixed rate. */
function RateRows(p: Parameters<typeof AmountField>[0] & { noRate: boolean }) {
	const t = useTranslations("entry");
	const { label: dates } = useDateFormat();
	const { d, home, rate } = p;
	if (d.currency === home) return null;
	return (
		<>
			{p.noRate && !d.custom ? (
				<MoneyInputRow tone="attention">
					<span className="min-w-0 flex-1">
						{t("rate.missing", {
							currency: d.currency,
							date: dates.short(d.date),
						})}
					</span>
					<Button kind="secondary" onClick={p.onCustom} size="sm">
						{t("rate.enterRate")}
					</Button>
				</MoneyInputRow>
			) : null}
			{d.custom ? (
				<MoneyInputRow>
					<span>{t("rate.customRate", { currency: d.currency })}</span>
					<Input
						aria-label={t("rate.customAria", { home })}
						autoFocus
						className="h-ctl-sm w-32 text-right tabular-nums"
						inputMode="decimal"
						onChange={(e) => p.onCustomText(e.target.value)}
						placeholder={t("rate.enterRate")}
						value={d.customText}
					/>
					<span>{home}</span>
				</MoneyInputRow>
			) : null}
			{/* A shared expense books at your default type: the rate is stated, not picked. */}
			{rate.picked && p.shared ? (
				<MoneyInputRow>
					<span className="text-fg-2">
						<RateLine rate={rate.picked.rate} type={rate.picked.rateType} />
						{` · ${dates.short(d.date)}`}
					</span>
					<span className="text-fg-3 text-meta">{t("rate.sharedFixed")}</span>
				</MoneyInputRow>
			) : null}
		</>
	);
}
