"use client";

import { ArrowRightLeftIcon, ChevronDownIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";

import { CurrencyPicker } from "~/components/pickers/currency-picker";
import { PickerPopover } from "~/components/pickers/picker-popover";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

/*
 * The parser comes from @retrospend/domain/parse (parseMoneyInput,
 * formatMoneyDraft, decimalSeparator, groupSeparator) and the preview from
 * @retrospend/domain/format (formatMoney). Until that lands on this branch
 * the caller passes them in; the types below are the domain's.
 */
export type MoneyInputError =
	| "empty"
	| "invalidCharacter"
	| "syntax"
	| "incomplete"
	| "ambiguous"
	| "tooPrecise"
	| "divideByZero"
	| "outOfRange"
	| "zero"
	| "negative";

export type MoneyInputResult =
	| { ok: true; minor: number; expression: boolean }
	| { ok: false; error: MoneyInputError };

export type MoneyInputParser = {
	parseMoneyInput: (
		text: string,
		locale: string,
		currency: string,
	) => MoneyInputResult;
	/** `previous` is the draft before this edit, so a newly typed foreign mark stays visible. */
	formatMoneyDraft: (
		text: string,
		locale: string,
		currency: string,
		previous?: string,
	) => string;
	decimalSeparator: (locale: string) => string;
	groupSeparator: (locale: string) => string;
	formatMoney: (
		m: { minor: number; currency: string },
		o: { locale: string },
	) => string;
};

/**
 * The caret after regrouping: as many non-group characters sit before it
 * as before the edit, so typing "1234" never jumps the caret past a comma.
 */
export function caretAfterRegroup(
	before: string,
	caret: number,
	after: string,
	group: string,
): number {
	let keep = 0;
	for (const ch of before.slice(0, caret)) if (ch !== group) keep++;
	let i = 0;
	for (; i < after.length && keep > 0; i++) if (after[i] !== group) keep--;
	return i;
}

/**
 * The numpad's decimal key types "." on most layouts, which is a group
 * separator in es-AR. It always means the decimal, so it types the
 * locale's decimal separator over the selection instead. A "." from the
 * main keyboard stays as typed, so the parser can call it ambiguous.
 */
export function numpadDecimal(
	e: { code: string; key: string },
	text: string,
	start: number,
	end: number,
	decimal: string,
): { text: string; caret: number } | null {
	if (e.code !== "NumpadDecimal" || e.key === decimal) return null;
	return {
		text: `${text.slice(0, start)}${decimal}${text.slice(end)}`,
		caret: start + decimal.length,
	};
}

/** Errors wait for blur: "12+" is incomplete while typing, not wrong. */
export function visibleError(
	result: MoneyInputResult,
	touched: boolean,
): MoneyInputError | null {
	if (result.ok || !touched || result.error === "empty") return null;
	return result.error;
}

export type MoneyInputProps = {
	parser: MoneyInputParser;
	currency: string;
	/** The draft text; keep it in state, with the result for Save. */
	value: string;
	onChange: (text: string, result: MoneyInputResult) => void;
	onCurrencyChange?: (code: string) => void;
	favoriteCurrencies?: readonly string[];
	/** Foreign amounts: the server's rate line, already formatted ("USD 1 = ARS 1,468 · Blue"). */
	rate?: { label: string; onClick?: () => void };
	/** Show errors now (after a Save attempt). */
	showErrors?: boolean;
	disabled?: boolean;
	id?: string;
	autoFocus?: boolean;
};

/**
 * MoneyInput (R22): the amount at input height, 16px medium. Groups
 * thousands while typing, reads the page locale, does + - × ÷ math with a
 * live result, and shows the rate chip for a foreign currency.
 */
export function MoneyInput(p: MoneyInputProps) {
	const t = useTranslations("pickers.money");
	const locale = useLocale();
	const { parser } = p;
	const ref = React.useRef<HTMLInputElement>(null);
	const pasted = React.useRef(false);
	const caret = React.useRef<number | null>(null);
	const [touched, setTouched] = React.useState(false);
	const [pickCurrency, setPickCurrency] = React.useState(false);
	const autoId = React.useId();
	const id = p.id ?? autoId;
	const result = parser.parseMoneyInput(p.value, locale, p.currency);
	const error = visibleError(result, touched || !!p.showErrors);

	React.useLayoutEffect(() => {
		if (caret.current == null || !ref.current) return;
		ref.current.setSelectionRange(caret.current, caret.current);
		caret.current = null;
	});

	const update = (raw: string, at: number) => {
		// A paste is read as typed first: drafting it would regroup "1,23"
		// and hide that it is ambiguous in this locale.
		const wasPaste = pasted.current;
		pasted.current = false;
		const asTyped = parser.parseMoneyInput(raw, locale, p.currency);
		const keepRaw = wasPaste && !asTyped.ok && asTyped.error === "ambiguous";
		const text = keepRaw
			? raw
			: parser.formatMoneyDraft(raw, locale, p.currency, p.value);
		caret.current = caretAfterRegroup(
			raw,
			at,
			text,
			parser.groupSeparator(locale),
		);
		p.onChange(
			text,
			keepRaw ? asTyped : parser.parseMoneyInput(text, locale, p.currency),
		);
	};

	const onInput = (e: React.ChangeEvent<HTMLInputElement>) =>
		update(e.target.value, e.target.selectionStart ?? e.target.value.length);

	const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		const el = e.currentTarget;
		const end = el.selectionEnd ?? el.value.length;
		const typed = numpadDecimal(
			e,
			el.value,
			el.selectionStart ?? end,
			end,
			parser.decimalSeparator(locale),
		);
		if (!typed) return;
		e.preventDefault();
		update(typed.text, typed.caret);
	};

	const preview =
		result.ok && result.expression
			? parser.formatMoney(
					{ minor: result.minor, currency: p.currency },
					{ locale },
				)
			: null;

	const currencyButton = (
		<Button
			aria-label={t("currency", { code: p.currency })}
			className="h-full rounded-none border-0 border-line-strong border-r px-3"
			disabled={p.disabled || !p.onCurrencyChange}
			type="button"
			variant="ghost"
		>
			{p.currency}
			{p.onCurrencyChange ? <ChevronDownIcon aria-hidden="true" /> : null}
		</Button>
	);

	return (
		<div className="flex flex-col gap-1">
			<div
				className={cn(
					"flex h-money items-stretch overflow-hidden rounded-ctl border border-line-strong bg-surface focus-within:ring-2 focus-within:ring-brand",
					error && "border-danger",
					p.disabled && "opacity-50",
				)}
			>
				{p.onCurrencyChange ? (
					<PickerPopover
						onOpenChange={setPickCurrency}
						open={pickCurrency}
						title={t("currency", { code: p.currency })}
						trigger={currencyButton}
					>
						<CurrencyPicker
							favorites={p.favoriteCurrencies}
							onChange={(code) => {
								setPickCurrency(false);
								p.onCurrencyChange?.(code);
							}}
							value={p.currency}
						/>
					</PickerPopover>
				) : (
					currencyButton
				)}
				<Input
					aria-describedby={error ? `${id}-error` : undefined}
					aria-invalid={error ? true : undefined}
					aria-label={t("amount")}
					autoComplete="off"
					autoFocus={p.autoFocus}
					className="h-full flex-1 rounded-none border-0 bg-transparent px-3 font-medium text-base tabular-nums shadow-none focus-visible:ring-0"
					disabled={p.disabled}
					id={id}
					inputMode="decimal"
					onBlur={() => setTouched(true)}
					onChange={onInput}
					onKeyDown={onKeyDown}
					onPaste={() => {
						pasted.current = true;
					}}
					placeholder="0"
					ref={ref}
					value={p.value}
				/>
				{preview ? (
					<span className="flex items-center pr-3 text-fg-2 text-small tabular-nums">
						{preview}
					</span>
				) : null}
			</div>
			{error ? (
				<span className="text-danger text-meta" id={`${id}-error`} role="alert">
					{t(`error.${error}`, {
						currency: p.currency,
						decimal: parser.decimalSeparator(locale),
					})}
				</span>
			) : null}
			{p.rate ? (
				<Button
					aria-label={t("rate", { rate: p.rate.label })}
					className="self-start font-normal text-fg-2 tabular-nums"
					disabled={!p.rate.onClick}
					onClick={p.rate.onClick}
					size="sm"
					type="button"
					variant="ghost"
				>
					<ArrowRightLeftIcon aria-hidden="true" />
					{p.rate.label}
				</Button>
			) : null}
		</div>
	);
}
