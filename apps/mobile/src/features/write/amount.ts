import { fromMinor, money } from "@retrospend/domain/money-minor";
import { parseMoneyInput } from "@retrospend/domain/parse";

// What the keypad typed, as the money writes need it. The keypad text is
// formatted by the domain package; the write carries decimal text in the
// currency's major units (the same as every other v1 write).

export type Entered =
	| { state: "empty" }
	| { state: "invalid" }
	/** A real zero: valid for "set to" and a balance, never for a move. */
	| { state: "zero" }
	| { state: "ok"; minor: number };

export function readAmount(
	text: string,
	locale: string,
	currency: string,
): Entered {
	if (text.trim() === "") return { state: "empty" };
	const read = parseMoneyInput(text, locale, currency);
	if (read.ok) return { state: "ok", minor: read.minor };
	return read.error === "zero" ? { state: "zero" } : { state: "invalid" };
}

/** Minor units of an entered amount, or null while it is not one (zero counts only when allowed). */
export function minorOf(entered: Entered, allowZero = false): number | null {
	if (entered.state === "ok") return entered.minor;
	return entered.state === "zero" && allowZero ? 0 : null;
}

/** Decimal text for the wire: 1234.5 ARS minor 123450 is "1234.50". */
export function wireAmount(minor: number, currency: string): string {
	return fromMinor(money(minor, currency));
}
