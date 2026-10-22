/**
 * Splits money input ("1.234,5 + 20×3") into tokens. Shared by
 * parseMoneyInput and formatMoneyDraft so the two always agree on where a
 * number starts and ends. Every token keeps its raw text, so joining the
 * tokens gives back the input exactly.
 */
import type { NumberSymbols } from "./format-locale";

export type Operator = "+" | "-" | "*" | "/";

export type Token =
	| { kind: "number"; text: string }
	| { kind: "op"; op: Operator; text: string }
	| { kind: "open"; text: string }
	| { kind: "close"; text: string }
	| { kind: "space"; text: string }
	| { kind: "other"; text: string };

const OPERATORS: Readonly<Record<string, Operator>> = {
	"+": "+",
	"-": "-",
	"−": "-",
	"*": "*",
	x: "*",
	X: "*",
	"×": "*",
	"/": "/",
	"÷": "/",
};

const APOSTROPHES = new Set(["'", "’"]);
const WHITESPACE = /\s/;
const DIGIT = /\d/;

/**
 * Whether `char` groups digits in this locale. A space-grouping locale (fr,
 * ru) takes any space, since people type a plain one; an apostrophe locale
 * (de-CH) takes either apostrophe.
 */
export function isGroupChar(char: string, symbols: NumberSymbols): boolean {
	const { group } = symbols;
	if (char === group) return true;
	if (WHITESPACE.test(group)) return WHITESPACE.test(char);
	return APOSTROPHES.has(group) && APOSTROPHES.has(char);
}

/** A "." or "," the locale uses for neither job: someone else's convention. */
export function isForeignMark(char: string, symbols: NumberSymbols): boolean {
	return (
		(char === "." || char === ",") &&
		char !== symbols.decimal &&
		!isGroupChar(char, symbols)
	);
}

function inNumber(text: string, at: number, symbols: NumberSymbols): boolean {
	const char = text[at] ?? "";
	if (DIGIT.test(char) || char === symbols.decimal) return true;
	if (char === "." || char === ",") return true;
	if (!isGroupChar(char, symbols)) return false;
	// A space only groups when a digit follows: "1 000 + 5" keeps " + 5" apart.
	return !WHITESPACE.test(char) || DIGIT.test(text[at + 1] ?? "");
}

export function tokenize(text: string, symbols: NumberSymbols): Token[] {
	const tokens: Token[] = [];
	let at = 0;
	while (at < text.length) {
		const char = text[at] as string;
		const op = OPERATORS[char];
		let end = at + 1;
		if (op) tokens.push({ kind: "op", op, text: char });
		else if (char === "(") tokens.push({ kind: "open", text: char });
		else if (char === ")") tokens.push({ kind: "close", text: char });
		else if (
			DIGIT.test(char) ||
			(inNumber(text, at, symbols) && !WHITESPACE.test(char))
		) {
			while (end < text.length && inNumber(text, end, symbols)) end++;
			tokens.push({ kind: "number", text: text.slice(at, end) });
		} else if (WHITESPACE.test(char)) {
			while (end < text.length && WHITESPACE.test(text[end] as string)) end++;
			tokens.push({ kind: "space", text: text.slice(at, end) });
		} else {
			tokens.push({ kind: "other", text: char });
		}
		at = end;
	}
	return tokens;
}
