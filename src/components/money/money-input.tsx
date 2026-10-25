"use client";

import { formatMoney } from "@retrospend/domain/format";
import {
	decimalSeparator,
	draftFromMinor,
	formatMoneyDraft,
	groupSeparator,
	type MoneyInputError,
	type MoneyInputResult,
	parseMoneyInput,
} from "@retrospend/domain/parse";
import { useLocale, useTranslations } from "next-intl";
import * as React from "react";

import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import {
	CurrencyChip,
	HomeRow,
	type MoneyHome,
	type MoneyRates,
	OperatorRow,
	RateStrip,
} from "./money-input-chips";

export type {
	MoneyHome,
	MoneyRateOption,
	MoneyRates,
} from "./money-input-chips";
export { MoneyInputRow } from "./money-input-chips";
export type { MoneyInputError, MoneyInputResult };

/**
 * The caret after the draft: if the draft kept the text as typed (a typed
 * group or foreign mark the parser will call ambiguous), the caret stays
 * where it was. Otherwise as many non-group characters sit before it as
 * before the edit, so typing "1234" never jumps the caret past a comma.
 */
export function caretAfterDraft(
	before: string,
	caret: number,
	after: string,
	group: string,
): number {
	if (after === before) return caret;
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

/**
 * One edit: a paste is read as typed first (drafting would regroup "1,23"
 * and hide that it is ambiguous here); anything else is drafted against the
 * previous text so a newly typed foreign mark stays visible.
 */
export function draftEdit(
	raw: string,
	at: number,
	o: { previous: string; pasted: boolean; locale: string; currency: string },
): { text: string; caret: number; result: MoneyInputResult } {
	const asTyped = parseMoneyInput(raw, o.locale, o.currency);
	if (o.pasted && !asTyped.ok && asTyped.error === "ambiguous")
		return { text: raw, caret: at, result: asTyped };
	const text = formatMoneyDraft(raw, o.locale, o.currency, o.previous);
	return {
		text,
		caret: caretAfterDraft(raw, at, text, groupSeparator(o.locale)),
		result: parseMoneyInput(text, o.locale, o.currency),
	};
}

/**
 * State for a MoneyInput that starts from a saved amount (or empty): the
 * text, its parse result and the onChange to pass through.
 */
export function useMoneyText(minor: number | null, currency: string) {
	const locale = useLocale();
	const [text, setText] = React.useState(() =>
		minor && minor > 0 ? draftFromMinor(minor, locale, currency) : "",
	);
	const result = parseMoneyInput(text, locale, currency);
	return { text, result, onChange: (next: string) => setText(next) };
}

export type MoneyInputProps = {
	currency: string;
	/** The draft text; keep it in state (useMoneyText), with the result for Save. */
	value: string;
	onChange: (text: string, result: MoneyInputResult) => void;
	onCurrencyChange?: (code: string) => void;
	favoriteCurrencies?: readonly string[];
	/** Words on the amount row, wide screens only ("You spent"). */
	label?: string;
	/** A foreign amount's rate types, side by side under the amount. */
	rates?: MoneyRates;
	/** Rows inside the field under the rates: a custom rate, a missing rate, a fixed rate line. */
	rows?: React.ReactNode;
	/** The converted amount in the home currency (the server's figure). */
	home?: MoneyHome;
	/** Show errors now (after a Save attempt). */
	showErrors?: boolean;
	disabled?: boolean;
	id?: string;
	autoFocus?: boolean;
	/** Phone web: the + − × ÷ row under the field while it has focus. */
	operators?: boolean;
};

/**
 * MoneyInput (R22): the amount at input height, 16px medium. Groups
 * thousands while typing, reads the page locale, does + - × ÷ math with a
 * live result. A foreign amount keeps its conversion in the same field:
 * the rate types side by side, then the home amount (kit .aex-amtg).
 */
export function MoneyInput(p: MoneyInputProps) {
	const t = useTranslations("pickers.money");
	const locale = useLocale();
	const field = useDraftField(p, locale);
	const autoId = React.useId();
	const id = p.id ?? autoId;
	const result = parseMoneyInput(p.value, locale, p.currency);
	const error = visibleError(result, field.touched || !!p.showErrors);
	const preview =
		result.ok && result.expression
			? formatMoney({ minor: result.minor, currency: p.currency }, { locale })
			: null;

	return (
		<div className="flex flex-col gap-1">
			<div
				className={cn(
					"rounded-ctl border-line-strong bg-surface ease-land focus-within:border-brand focus-within:ring-brand overflow-hidden border transition-colors duration-(--t-state) focus-within:ring-1",
					error && "border-danger ring-danger ring-1",
					p.disabled && "opacity-50",
				)}
			>
				{/* kit .moneyinput: the currency chip inside the field, the amount on the right */}
				<div className="h-money flex items-center gap-2 p-1">
					<CurrencyChip {...p} />
					{p.label ? (
						<span className="text-fg-3 text-small shrink-0 max-md:hidden">
							{p.label}
						</span>
					) : null}
					<Input
						aria-describedby={error ? `${id}-error` : undefined}
						aria-invalid={error ? true : undefined}
						aria-label={t("amount")}
						autoComplete="off"
						autoFocus={p.autoFocus}
						className="text-fg placeholder:text-fg-3 h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 pr-2 text-right text-base font-medium tabular-nums shadow-none focus-visible:ring-0 dark:bg-transparent"
						disabled={p.disabled}
						id={id}
						inputMode="decimal"
						placeholder="0"
						value={p.value}
						{...field.handlers}
					/>
				</div>
				{p.rates ? <RateStrip rates={p.rates} /> : null}
				{p.rows}
				{p.home ? <HomeRow home={p.home} /> : null}
			</div>
			{p.operators && field.focused ? (
				<OperatorRow onKey={field.insert} />
			) : null}
			{error ? (
				<span className="text-danger text-meta" id={`${id}-error`} role="alert">
					{t(`error.${error}`, {
						currency: p.currency,
						decimal: decimalSeparator(locale),
					})}
				</span>
			) : null}
			{preview ? (
				<span className="text-fg-2 text-small text-right tabular-nums">
					{preview}
				</span>
			) : null}
		</div>
	);
}

/** The input's edit, paste, numpad and caret handling. */
function useDraftField(p: MoneyInputProps, locale: string) {
	const ref = React.useRef<HTMLInputElement>(null);
	const pasted = React.useRef(false);
	const caret = React.useRef<number | null>(null);
	const [touched, setTouched] = React.useState(false);
	const [focused, setFocused] = React.useState(false);

	React.useLayoutEffect(() => {
		if (caret.current == null || !ref.current) return;
		ref.current.setSelectionRange(caret.current, caret.current);
		caret.current = null;
	});

	const update = (raw: string, at: number) => {
		const edit = draftEdit(raw, at, {
			previous: p.value,
			pasted: pasted.current,
			locale,
			currency: p.currency,
		});
		pasted.current = false;
		caret.current = edit.caret;
		p.onChange(edit.text, edit.result);
	};

	/** An operator key: typed over the selection, as if from the keyboard. */
	const insert = (op: string) => {
		const el = ref.current;
		const text = el?.value ?? p.value;
		const end = el?.selectionEnd ?? text.length;
		const start = el?.selectionStart ?? end;
		update(`${text.slice(0, start)}${op}${text.slice(end)}`, start + op.length);
	};

	const handlers = {
		ref,
		onFocus: () => setFocused(true),
		onBlur: () => {
			setTouched(true);
			setFocused(false);
		},
		onPaste: () => {
			pasted.current = true;
		},
		onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
			update(e.target.value, e.target.selectionStart ?? e.target.value.length),
		onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
			const el = e.currentTarget;
			const end = el.selectionEnd ?? el.value.length;
			const start = el.selectionStart ?? end;
			const typed = numpadDecimal(
				e,
				el.value,
				start,
				end,
				decimalSeparator(locale),
			);
			if (!typed) return;
			e.preventDefault();
			update(typed.text, typed.caret);
		},
	};
	return { touched, focused, insert, handlers };
}
