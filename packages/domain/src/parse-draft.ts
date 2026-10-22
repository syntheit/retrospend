/**
 * The text MoneyInput shows while someone types: each operand regrouped
 * with the locale's separators, and the editable text for a saved value.
 * Reading that text as money is parseMoneyInput's job (./parse).
 */
import { isCrypto } from "./currency-format";
import {
	groupDigits,
	type NumberSymbols,
	numberSymbols,
} from "./format-locale";
import { currencyDecimals } from "./money";
import { fromMinor, money } from "./money-minor";
import {
	isForeignMark,
	isGroupChar,
	type Token,
	tokenize,
} from "./parse-tokens";

/** Index of the nearest non-space token before `i` (-1 if none). */
function before(tokens: Token[], i: number): number {
	let j = i - 1;
	while (tokens[j]?.kind === "space") j--;
	return j;
}

/** Index of the nearest non-space token after `i`. */
function after(tokens: Token[], i: number): number {
	let j = i + 1;
	while (tokens[j]?.kind === "space") j++;
	return j;
}

const isMul = (t: Token | undefined) =>
	t?.kind === "op" && (t.op === "*" || t.op === "/");
const isSign = (t: Token | undefined) =>
	t?.kind === "op" && (t.op === "+" || t.op === "-");

/** Whether a times or divide sign sits before `i`, past any unary signs ("2*-3"). */
function mulBefore(tokens: Token[], i: number): boolean {
	let j = before(tokens, i);
	while (isSign(tokens[j])) {
		const k = before(tokens, j);
		const t = tokens[k];
		// A sign after a number or ")" is binary: the operand is a term of a sum.
		if (t && t.kind !== "op" && t.kind !== "open") break;
		j = k;
	}
	return isMul(tokens[j]);
}

/**
 * For each token, whether it is a factor or divisor rather than money: next
 * to a times or divide sign, or inside parentheses that are ("2*(1.005+1)").
 * Iterative, so deep nesting cannot overflow the stack.
 */
function factorFlags(tokens: Token[]): boolean[] {
	const closeOf = new Map<number, number>();
	const opens: number[] = [];
	tokens.forEach((t, i) => {
		if (t.kind === "open") opens.push(i);
		const open = t.kind === "close" ? opens.pop() : undefined;
		if (open !== undefined) closeOf.set(open, i);
	});
	const groups: boolean[] = [];
	return tokens.map((t, i) => {
		const inFactor = groups[groups.length - 1] ?? false;
		// A group is judged by what follows its ")"; an unclosed one by nothing.
		const last = t.kind === "open" ? closeOf.get(i) : i;
		const flag =
			inFactor ||
			mulBefore(tokens, i) ||
			(last !== undefined && isMul(tokens[after(tokens, last)]));
		if (t.kind === "open") groups.push(flag);
		if (t.kind === "close") groups.pop();
		return flag;
	});
}

/** One operand regrouped; anything it cannot read stays as typed. */
function draftNumber(
	text: string,
	symbols: NumberSymbols,
	maxFraction: number,
): string {
	if ([...text].some((char) => isForeignMark(char, symbols))) return text;
	const point = text.indexOf(symbols.decimal);
	const whole = point < 0 ? text : text.slice(0, point);
	const digits = [...whole].filter((c) => !isGroupChar(c, symbols)).join("");
	if (!/^\d*$/.test(digits)) return text;
	// The 000 key on an empty field gives "0"; "0005" is "5".
	const grouped = groupDigits(digits.replace(/^0+(?=\d)/, ""), symbols);
	if (point < 0) return grouped;
	const fraction = text.slice(point + 1);
	if (!/^\d*$/.test(fraction)) return grouped + text.slice(point);
	return grouped + symbols.decimal + fraction.slice(0, maxFraction);
}

function regroup(text: string, symbols: NumberSymbols, decimals: number) {
	const tokens = tokenize(text, symbols);
	const factors = factorFlags(tokens);
	return tokens
		.map((token, i) =>
			token.kind === "number"
				? draftNumber(
						token.text,
						symbols,
						factors[i] ? Number.POSITIVE_INFINITY : decimals,
					)
				: token.text,
		)
		.join("");
}

/** What changed from `previous` to `text`: the inserted or pasted part. */
function inserted(previous: string, text: string): string {
	const shorter = Math.min(previous.length, text.length);
	let start = 0;
	while (start < shorter && previous[start] === text[start]) start++;
	let end = 0;
	while (
		end < shorter - start &&
		previous[previous.length - 1 - end] === text[text.length - 1 - end]
	) {
		end++;
	}
	return text.slice(start, text.length - end);
}

/**
 * A "." or "," that is not the locale's decimal: a group separator someone
 * typed, or another convention's decimal mark. Taking it as grouping would
 * turn "12.50" in es-AR into 1,250, a hundred times the amount.
 */
function hasTypedMark(text: string, symbols: NumberSymbols): boolean {
	return [...text].some(
		(char) => (char === "." || char === ",") && char !== symbols.decimal,
	);
}

/**
 * Grouping while typing: regroups the integer part of every operand with
 * the locale's separators ("1234567,5" -> "1.234.567,5" in es-AR) and caps a
 * money operand at the currency's decimals. Operators, spaces, a trailing
 * decimal separator and anything unreadable stay as typed, and
 * formatMoneyDraft(formatMoneyDraft(x)) === formatMoneyDraft(x).
 *
 * Pass `previous`, the draft this returned for the last change. When the
 * change inserts a "." or "," that is not the locale's decimal (a typed
 * group separator, or a decimal mark from another convention), the text is
 * returned as typed, and stays so while that mark is there, so
 * parseMoneyInput reports it as ambiguous instead of the draft swallowing
 * it. Without `previous` every group separator is taken as the field's own.
 */
export function formatMoneyDraft(
	text: string,
	locale: string,
	currency: string,
	previous?: string,
): string {
	const symbols = numberSymbols(locale);
	const decimals = currencyDecimals(currency);
	if (previous !== undefined) {
		const typedMark = hasTypedMark(inserted(previous, text), symbols);
		// A previous draft that is not its own regrouping was kept as typed.
		const keptAsTyped =
			hasTypedMark(text, symbols) &&
			regroup(previous, symbols, decimals) !== previous;
		if (typedMark || keptAsTyped) return text;
	}
	return regroup(text, symbols, decimals);
}

/**
 * The editable text for a saved positive amount: locale separators, no
 * currency, every minor digit the value needs ("1,234.50", "1,234" for
 * 1,234.00, "1.23456789" BTC). parseMoneyInput reads it back to the same
 * minor, and formatMoneyDraft leaves it as it is.
 */
export function draftFromMinor(
	minor: number,
	locale: string,
	currency: string,
): string {
	const value = money(minor, currency);
	const plain = fromMinor(value);
	const negative = plain.startsWith("-");
	const [whole = "", fraction = ""] = (negative ? plain.slice(1) : plain).split(
		".",
	);
	const shown = isCrypto(value.currency)
		? fraction.replace(/0+$/, "")
		: /[1-9]/.test(fraction)
			? fraction
			: "";
	const symbols = numberSymbols(locale);
	return (
		(negative ? "-" : "") +
		groupDigits(whole, symbols) +
		(shown ? symbols.decimal + shown : "")
	);
}
