"use client";

import { decimalSeparator, parseMoneyInput } from "@retrospend/domain/parse";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import type { MoneyValue } from "./format";
import { Money } from "./money";
import {
	type MoneyInputResult,
	useDraftField,
	visibleError,
} from "./money-input";

export type MoneyCellProps = {
	/** The draft text; keep it in state, like MoneyInput. */
	value: string;
	currency: string;
	/** The accessible name: the row says what this amount is for. */
	label: string;
	onChange: (text: string, result: MoneyInputResult) => void;
	/** The row is not editable here: the amount reads as text, aligned the same. */
	readOnly?: boolean;
	/** The server says this amount cannot be used (a limit, a missing rate). */
	invalid?: boolean;
	/** Show errors now (after a Save attempt). */
	showErrors?: boolean;
	/** A foreign amount: its ISO code leads the figure. */
	showCurrency?: boolean;
	/** The converted amount in the home currency (the server's figure), under the cell. */
	home?: MoneyValue;
	autoFocus?: boolean;
	className?: string;
};

/**
 * MoneyCell: inline amount entry in a table row (the assign sheet lists up
 * to thirty). It reads, groups and does + - × ÷ math exactly like MoneyInput
 * (the same draft, parse, caret and numpad handling) but has no currency
 * chip, rate strip or operator row: the row and the sheet name the currency
 * once. Right-aligned, tabular figures. Use MoneyInput for the one amount a
 * form asks for.
 */
export function MoneyCell({
	value,
	currency,
	label,
	onChange,
	readOnly = false,
	invalid = false,
	showErrors = false,
	showCurrency = false,
	home,
	autoFocus,
	className,
}: MoneyCellProps) {
	const t = useTranslations("pickers.money");
	const locale = useLocale();
	const field = useDraftField({ value, currency, onChange }, locale);
	const id = React.useId();
	const error = readOnly
		? null
		: visibleError(
				parseMoneyInput(value, locale, currency),
				field.touched || showErrors,
			);
	const bad = invalid || error != null;
	return (
		<div className={cn("flex flex-col items-end gap-1", className)}>
			<div className="flex items-center gap-2">
				{showCurrency ? (
					<span className="text-fg-3 text-meta shrink-0">{currency}</span>
				) : null}
				<Input
					aria-describedby={error ? `${id}-error` : undefined}
					aria-invalid={bad || undefined}
					aria-label={label}
					aria-readonly={readOnly || undefined}
					autoComplete="off"
					autoFocus={autoFocus}
					className={cn(
						"rounded-ctl text-fg placeholder:text-fg-3 h-ctl max-md:h-money w-32 px-3 text-right text-base font-medium tabular-nums",
						readOnly
							? "border-0 bg-transparent shadow-none dark:bg-transparent"
							: "border-line-strong bg-surface border",
						bad && "border-danger",
					)}
					inputMode="decimal"
					placeholder="0"
					readOnly={readOnly}
					value={value}
					{...field.handlers}
				/>
			</div>
			{error ? (
				<span className="text-danger text-meta" id={`${id}-error`} role="alert">
					{t(`error.${error}`, {
						currency,
						decimal: decimalSeparator(locale),
					})}
				</span>
			) : null}
			{home ? (
				<span className="text-fg-3 text-meta">
					<Money value={home} />
				</span>
			) : null}
		</div>
	);
}

/** The minor units typed in `text`, or null when it is empty or unreadable. */
export function minorOf(
	text: string,
	locale: string,
	currency: string,
): number | null {
	const r = parseMoneyInput(text, locale, currency);
	return r.ok ? r.minor : null;
}
