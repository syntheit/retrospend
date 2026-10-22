"use client";

import { ArrowRightLeftIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { CurrencyPicker } from "~/components/pickers/currency-picker";
import { PickerPopover } from "~/components/pickers/picker-popover";
import { Button } from "~/components/ui/button";
import { FilterChip } from "~/components/ui/chip";
import type { MoneyInputProps } from "./money-input";

/** The rate chip (kit .ratechip): a button when the rate can change, else a label. */
export function RateChip(r: NonNullable<MoneyInputProps["rate"]>) {
	const t = useTranslations("pickers.money");
	const look =
		"inline-flex h-ctl-sm items-center gap-2 rounded-chip bg-raised px-3 font-normal text-fg-2 text-small tabular-nums";
	if (!r.onClick)
		return (
			<span className={look}>
				<ArrowRightLeftIcon aria-hidden="true" className="size-4" />
				{r.label}
			</span>
		);
	return (
		<Button
			aria-label={t("rate", { rate: r.label })}
			className={look}
			kind="ghost"
			onClick={r.onClick}
			size="sm"
		>
			<ArrowRightLeftIcon aria-hidden="true" />
			{r.label}
		</Button>
	);
}

/** The currency chip: opens the CurrencyPicker when the currency can change. */
export function CurrencyChip(p: MoneyInputProps) {
	const t = useTranslations("pickers.money");
	const [open, setOpen] = React.useState(false);
	// A fixed currency still shows as the chip, without the chevron (kit .chip).
	if (!p.onCurrencyChange)
		return (
			<span className="inline-flex h-ctl shrink-0 items-center rounded-chip border border-line-strong px-3 font-medium text-body text-fg-2">
				{p.currency}
			</span>
		);
	const button = (
		<FilterChip
			aria-label={t("currency", { code: p.currency })}
			className="bg-transparent text-fg-2"
			disabled={p.disabled}
			value
		>
			{p.currency}
		</FilterChip>
	);
	return (
		<PickerPopover
			onOpenChange={setOpen}
			open={open}
			title={t("currency", { code: p.currency })}
			trigger={button}
		>
			<CurrencyPicker
				favorites={p.favoriteCurrencies}
				onChange={(code) => {
					setOpen(false);
					p.onCurrencyChange?.(code);
				}}
				value={p.currency}
			/>
		</PickerPopover>
	);
}
