import { decimalSeparator, formatMoneyDraft } from "@retrospend/domain/parse";

// The money keypad's logic, apart from its views so the golden keystroke
// vectors from @retrospend/domain run against it. The draft is formatted by
// the domain package (grouping, decimal places for the currency); the keypad
// only decides which characters each key adds.

export const BACKSPACE = "⌫";
export const TRIPLE_ZERO = "000";

export type KeypadKey = string;

/** Rows of keys, top to bottom, with the locale's decimal separator. */
export function keypadLayout(locale: string): KeypadKey[][] {
	return [
		["1", "2", "3"],
		["4", "5", "6"],
		["7", "8", "9"],
		[decimalSeparator(locale), "0", BACKSPACE],
		[TRIPLE_ZERO],
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
