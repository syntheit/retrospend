import { decimalSeparator, formatMoneyDraft } from "@retrospend/domain/parse";

// The money keypad's logic, apart from its views so the golden keystroke
// vectors from @retrospend/domain run against it. The draft is formatted by
// the domain package (grouping, decimal places for the currency); the keypad
// only decides which characters each key adds.

export const BACKSPACE = "⌫";
export type KeypadKey = string;

/** Rows of keys, top to bottom, with the locale's decimal separator: the system number pad. */
export function keypadLayout(locale: string): KeypadKey[][] {
	return [
		["1", "2", "3"],
		["4", "5", "6"],
		["7", "8", "9"],
		[decimalSeparator(locale), "0", BACKSPACE],
	];
}

/** The draft after one key press. */
export function applyKey(
	draft: string,
	key: KeypadKey,
	locale: string,
	currency: string,
): string {
	const text = key === BACKSPACE ? draft.slice(0, -1) : draft + key;
	return formatMoneyDraft(text, locale, currency, draft);
}

/** What a keypad types: an amount of money, a percent, or a whole number of shares. */
export type EntryKind = "money" | "percent" | "units";

/** A percent reads 100 or 99.99; shares are whole numbers of up to six digits. */
const PERCENT_DIGITS = 3;
const PERCENT_DECIMALS = 2;
const UNITS_DIGITS = 6;

/**
 * The text after one key press on a part that is not money (a percent, a
 * number of shares): plain digits, the locale's decimal separator for a
 * percent, no grouping. The server reads the parts and says whether they add
 * up, so nothing here checks the total.
 */
export function applyPlainKey(
	text: string,
	key: KeypadKey,
	kind: Exclude<EntryKind, "money">,
	locale: string,
): string {
	if (key === BACKSPACE) return text.slice(0, -1);
	const separator = decimalSeparator(locale);
	if (kind === "units") {
		if (!/^\d$/.test(key)) return text;
		const next = text === "0" ? key : text + key;
		return next.length > UNITS_DIGITS ? text : next;
	}
	if (key === separator) {
		if (text.includes(separator)) return text;
		return `${text || "0"}${separator}`;
	}
	if (!/^\d$/.test(key)) return text;
	const [whole = "", decimals] = text.split(separator);
	if (decimals !== undefined) {
		return decimals.length >= PERCENT_DECIMALS ? text : text + key;
	}
	const next = whole === "0" ? key : text + key;
	return next.length > PERCENT_DIGITS ? text : next;
}

/** Applies a key to whatever the keypad is typing. */
export function applyEntryKey(
	text: string,
	key: KeypadKey,
	kind: EntryKind,
	locale: string,
	currency: string,
): string {
	return kind === "money"
		? applyKey(text, key, locale, currency)
		: applyPlainKey(text, key, kind, locale);
}
