"use client";

import { useTranslations } from "next-intl";
import * as React from "react";

import { CurrencyPicker } from "~/components/pickers/currency-picker";
import { PickerPopover } from "~/components/pickers/picker-popover";
import { Button } from "~/components/ui/button";
import { FilterChip } from "~/components/ui/chip";
import { CurrencyFlag } from "~/components/ui/currency-flag";
import { cn } from "~/lib/utils";
import type { MoneyInputProps } from "./money-input";

/** One rate type of the pair, as the server offers it. */
export type MoneyRateOption = {
	value: string;
	/** The type's name: "Blue", "Custom". */
	label: string;
	/** Its rate, already formatted (a Money), or a mark for Custom. */
	rate?: React.ReactNode;
	/** What the amount books at this type (the server's figure), wide screens only. */
	home?: React.ReactNode;
	/** Overrides the button's name, e.g. to say it is the default. */
	ariaLabel?: string;
};

export type MoneyRates = {
	/** Accessible name of the group ("Rate"). */
	label: string;
	value: string | null;
	options: MoneyRateOption[];
	onChange: (value: string) => void;
};

/** The converted amount: the home currency with its flag and the server's figure. */
export type MoneyHome = {
	currency: string;
	/** The booked home amount (a Money), or the word for its state. */
	value: React.ReactNode;
	/** "In budget as", "Your share in budget". */
	label: string;
};

/** Flag and code: the identity of a currency on every chip (R25). The code names it; the flag is decoration for readers. */
function CurrencyMark({ code }: { code: string }) {
	return (
		<>
			<span aria-hidden="true" className="inline-flex shrink-0">
				<CurrencyFlag className="size-4" currencyCode={code} />
			</span>
			{code}
		</>
	);
}

const fixedChip =
	"inline-flex h-ctl shrink-0 items-center gap-2 rounded-chip border border-line-strong px-3 font-medium text-body text-fg-2";

/** The currency chip: flag and code; opens the CurrencyPicker when the currency can change. */
export function CurrencyChip(p: MoneyInputProps) {
	const t = useTranslations("pickers.money");
	const [open, setOpen] = React.useState(false);
	// A fixed currency still shows as the chip, without the chevron (kit .chip).
	if (!p.onCurrencyChange)
		return (
			<span className={fixedChip}>
				<CurrencyMark code={p.currency} />
			</span>
		);
	const button = (
		<FilterChip
			aria-label={t("currency", { code: p.currency })}
			className="text-fg bg-transparent font-medium"
			disabled={p.disabled}
			value
		>
			<CurrencyMark code={p.currency} />
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

/**
 * The rate strip (kit .aex-rs): every type the pair offers, each with its
 * rate, side by side under the amount, so the choice is one tap and the
 * numbers can be compared. Rates and home amounts come from the server.
 */
export function RateStrip({ rates }: { rates: MoneyRates }) {
	return (
		<div
			aria-label={rates.label}
			className="border-line-strong flex overflow-x-auto border-t"
			role="group"
		>
			{rates.options.map((o, i) => {
				const on = o.value === rates.value;
				return (
					<Button
						aria-label={o.ariaLabel}
						aria-pressed={on}
						className={cn(
							"h-auto min-w-16 flex-1 flex-col gap-0 rounded-none border-0 px-2 py-2 focus-visible:-outline-offset-2",
							i < rates.options.length - 1 && "border-line border-r",
							// Selected by fill, as a selected chip (no stripe, R31).
							on && "bg-brand-soft text-fg can-hover:hover:bg-brand-soft",
						)}
						key={o.value}
						kind="ghost"
						onClick={() => rates.onChange(o.value)}
					>
						<span className="text-meta font-medium">{o.label}</span>
						{o.rate ? (
							<span className="text-small tabular-nums">{o.rate}</span>
						) : null}
						{o.home ? (
							<span className="text-fg-3 text-meta tabular-nums max-md:hidden">
								{o.home}
							</span>
						) : null}
					</Button>
				);
			})}
		</div>
	);
}

/** The home row (kit .aex-hr): what the amount counts as, in the home currency. */
export function HomeRow({ home }: { home: MoneyHome }) {
	return (
		<div className="h-money border-line-strong bg-bg flex items-center gap-2 border-t p-1">
			<span className={cn(fixedChip, "border-transparent")}>
				<CurrencyMark code={home.currency} />
			</span>
			<span className="text-fg-3 text-small min-w-0 flex-1 truncate">
				{home.label}
			</span>
			<span className="text-body text-fg pr-2 font-medium tabular-nums">
				{home.value}
			</span>
		</div>
	);
}

/** The four keys of the operators row, as typed into the field. */
export const OPERATORS = ["+", "−", "×", "÷"] as const;

/**
 * The operators row (ADD-EXPENSE-R2 `.aex-ops`): phone web's decimal pad
 * has no + − × ÷, so while the amount has focus four keys sit under the
 * field. A press keeps the focus in the field (no keyboard flicker).
 */
export function OperatorRow({ onKey }: { onKey: (op: string) => void }) {
	const t = useTranslations("pickers.money");
	return (
		<div
			aria-label={t("operators")}
			className="flex gap-2 md:hidden"
			role="group"
		>
			{OPERATORS.map((op) => (
				<Button
					aria-label={t(`operator.${OPERATOR_KEY[op]}`)}
					className="h-money bg-raised text-fg text-section flex-1 font-semibold"
					key={op}
					kind="ghost"
					onClick={() => onKey(op)}
					onPointerDown={(e) => e.preventDefault()}
				>
					{op}
				</Button>
			))}
		</div>
	);
}

const OPERATOR_KEY = {
	"+": "plus",
	"−": "minus",
	"×": "times",
	"÷": "divide",
} as const;

/** A row inside the MoneyInput field, under a hairline (custom rate, notices). */
export function MoneyInputRow({
	tone = "plain",
	children,
}: {
	tone?: "plain" | "attention";
	children: React.ReactNode;
}) {
	return (
		<div
			className={cn(
				"min-h-ctl border-line-strong text-fg-2 text-small flex flex-wrap items-center gap-2 border-t px-3 py-2",
				tone === "attention" && "bg-attention-bg text-fg",
			)}
			role={tone === "attention" ? "status" : undefined}
		>
			{children}
		</div>
	);
}
