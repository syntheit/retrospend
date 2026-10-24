"use client";

import {
	type MoneyInputResult,
	parseMoneyInput,
} from "@retrospend/domain/parse";
import { useLocale } from "next-intl";
import { draftEdit } from "~/components/money/money-input";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

/**
 * A compact amount for a row of a Budget sheet (the assign sheet lists up to
 * thirty). It reads and groups like MoneyInput (same draft and parse
 * functions, the page locale, + and - math) but has no currency chip: every
 * amount in these sheets is in the book currency, named once in the sheet.
 */
export function AmountCell({
	value,
	currency,
	label,
	onChange,
	invalid = false,
	className,
	autoFocus,
}: {
	value: string;
	currency: string;
	/** The accessible name: the row says what this amount is for. */
	label: string;
	onChange: (text: string, result: MoneyInputResult) => void;
	invalid?: boolean;
	className?: string;
	autoFocus?: boolean;
}) {
	const locale = useLocale();
	return (
		<Input
			aria-invalid={invalid || undefined}
			aria-label={label}
			autoComplete="off"
			autoFocus={autoFocus}
			className={cn(
				"rounded-ctl border-line-strong bg-surface text-fg placeholder:text-fg-3 h-ctl w-32 border px-3 text-right text-base font-medium tabular-nums",
				invalid && "border-danger",
				className,
			)}
			inputMode="decimal"
			onChange={(e) => {
				const edit = draftEdit(
					e.target.value,
					e.target.selectionStart ?? e.target.value.length,
					{ previous: value, pasted: false, locale, currency },
				);
				onChange(edit.text, edit.result);
			}}
			placeholder="0"
			value={value}
		/>
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
