/**
 * Money input: what a person types into MoneyInput (web) or the keypad
 * (mobile), read in their locale. Shared by every client, so "1.234,56" means
 * the same thing everywhere.
 *
 * - Locale punctuation only: es-AR "1.234,56", en-US "1,234.56". Input that
 *   only makes sense in another convention ("1,23" in en-US, "12.50" in
 *   es-AR, misplaced groups) is refused as ambiguous, never guessed.
 * - Simple math: + - * / (also − × ÷ x) and parentheses, evaluated exactly
 *   on rationals (no eval, no float), then rounded half to even to the
 *   currency's minor unit.
 * - An amount typed as money (a bare term of a sum) may not be more precise
 *   than the currency ("12.345" USD); a factor or divisor may ("15.99*1.0825").
 * - The result must be positive.
 *
 * Golden cases: packages/domain/vectors/money-parse.vectors.json.
 */
import { type NumberSymbols, numberSymbols } from "./format-locale";
import { currencyDecimals } from "./money";
import {
	isForeignMark,
	isGroupChar,
	type Token,
	tokenize,
} from "./parse-tokens";

export { decimalSeparator, groupSeparator } from "./format-locale";
export { draftFromMinor, formatMoneyDraft } from "./parse-draft";

export type MoneyInputError =
	/** Nothing typed. */
	| "empty"
	/** A letter, symbol or currency sign. */
	| "invalidCharacter"
	/** Unbalanced or misplaced operators, numbers or parentheses. */
	| "syntax"
	/** Not finished yet: a trailing operator or an open parenthesis. */
	| "incomplete"
	/** Punctuation from another locale's convention, or misplaced grouping. */
	| "ambiguous"
	/** More decimals than the currency has ("12.345" USD, "1200.5" JPY). */
	| "tooPrecise"
	| "divideByZero"
	/** Beyond the safe-integer range of minor units. */
	| "outOfRange"
	| "zero"
	| "negative";

export type MoneyInputResult =
	| { ok: true; minor: number; expression: boolean }
	| { ok: false; error: MoneyInputError };

interface Ratio {
	n: bigint;
	/** Always positive. */
	d: bigint;
}

interface Operand {
	value: Ratio;
	/** Most decimals of a literal typed as money in this operand (0 if none). */
	moneyDecimals: number;
}

class InputError extends Error {
	constructor(public readonly code: MoneyInputError) {
		super(code);
	}
}

/** The digits of a grouped integer part, or null when the grouping is off. */
function ungroup(part: string, symbols: NumberSymbols): string | null {
	const chunks: string[] = [""];
	for (const char of part) {
		if (isGroupChar(char, symbols)) chunks.push("");
		else chunks[chunks.length - 1] += char;
	}
	if (chunks.length === 1) return part;
	const { primary, secondary } = symbols;
	const ok = chunks.every((chunk, i) => {
		if (i === chunks.length - 1) return chunk.length === primary;
		if (i === 0) return chunk.length >= 1 && chunk.length <= secondary;
		return chunk.length === secondary;
	});
	return ok && primary > 0 ? chunks.join("") : null;
}

/** "1.234,5" -> 12345/10 in es-AR, with the fraction digits it was typed with. */
function readNumber(
	text: string,
	symbols: NumberSymbols,
): { value: Ratio; fraction: string } {
	if ([...text].some((char) => isForeignMark(char, symbols))) {
		throw new InputError("ambiguous");
	}
	const [whole = "", fraction = "", ...extra] = text.split(symbols.decimal);
	if (extra.length > 0) throw new InputError("syntax");
	if (!/^\d*$/.test(fraction)) throw new InputError("ambiguous");
	const digits = ungroup(whole, symbols);
	if (digits === null) throw new InputError("ambiguous");
	if (digits === "" && fraction === "") throw new InputError("syntax");
	return {
		value: {
			n: BigInt((digits || "0") + fraction),
			d: 10n ** BigInt(fraction.length),
		},
		fraction,
	};
}

/** Deeper input is refused as syntax: nobody types it, and recursion has limits. */
const MAX_DEPTH = 64;

/**
 * Recursive descent over expr := term (+|- term)*, term := unary (*|/ unary)*.
 * Each operand carries moneyDecimals: the most decimals any literal typed as
 * money has inside it. A term with a * or / is a product, so its literals
 * are factors and drop out ("2*(1.005+1)"); what is left is checked once,
 * at the top.
 */
class Evaluator {
	private at = 0;
	private depth = 0;

	constructor(
		private readonly tokens: Token[],
		private readonly symbols: NumberSymbols,
	) {}

	run(): Operand {
		const result = this.expr();
		if (this.at < this.tokens.length) throw new InputError("syntax");
		return result;
	}

	private peekOp(...ops: string[]): string | null {
		const token = this.tokens[this.at];
		return token?.kind === "op" && ops.includes(token.op) ? token.op : null;
	}

	private nested<T>(read: () => T): T {
		if (++this.depth > MAX_DEPTH) throw new InputError("syntax");
		const result = read();
		this.depth--;
		return result;
	}

	private expr(): Operand {
		let { value, moneyDecimals } = this.term();
		for (let op = this.peekOp("+", "-"); op; op = this.peekOp("+", "-")) {
			this.at++;
			const rhs = this.term();
			const n = op === "+" ? rhs.value.n : -rhs.value.n;
			value = {
				n: value.n * rhs.value.d + n * value.d,
				d: value.d * rhs.value.d,
			};
			moneyDecimals = Math.max(moneyDecimals, rhs.moneyDecimals);
		}
		return { value, moneyDecimals };
	}

	private term(): Operand {
		const first = this.unary();
		let value = first.value;
		let factors = 0;
		for (let op = this.peekOp("*", "/"); op; op = this.peekOp("*", "/")) {
			this.at++;
			factors++;
			const rhs = this.unary().value;
			if (op === "*") value = { n: value.n * rhs.n, d: value.d * rhs.d };
			else if (rhs.n === 0n) throw new InputError("divideByZero");
			else {
				const sign = rhs.n < 0n ? -1n : 1n;
				value = { n: value.n * rhs.d * sign, d: value.d * rhs.n * sign };
			}
		}
		return { value, moneyDecimals: factors === 0 ? first.moneyDecimals : 0 };
	}

	private unary(): Operand {
		const op = this.peekOp("+", "-");
		if (!op) return this.primary();
		this.at++;
		const inner = this.nested(() => this.unary());
		if (op === "+") return inner;
		return { ...inner, value: { n: -inner.value.n, d: inner.value.d } };
	}

	private primary(): Operand {
		const token = this.tokens[this.at++];
		if (!token) throw new InputError("incomplete");
		if (token.kind === "number") {
			const { value, fraction } = readNumber(token.text, this.symbols);
			// Trailing zeros are exact ("12.500", the 000 key after a decimal).
			return { value, moneyDecimals: fraction.replace(/0+$/, "").length };
		}
		if (token.kind !== "open") throw new InputError("syntax");
		const inner = this.nested(() => this.expr());
		const close = this.tokens[this.at++];
		if (!close) throw new InputError("incomplete");
		if (close.kind !== "close") throw new InputError("syntax");
		return inner;
	}
}

/** n/d rounded half to even, for n >= 0 and d > 0. */
function roundHalfEven(n: bigint, d: bigint): bigint {
	const kept = n / d;
	const twice = (n % d) * 2n;
	return twice > d || (twice === d && kept % 2n === 1n) ? kept + 1n : kept;
}

/**
 * Reads typed money in `locale` as minor units of `currency`, or a typed
 * error. For live typing, pass the field's text through formatMoneyDraft
 * with the previous draft first; it keeps a typed "." or "," as typed so
 * this reports it as ambiguous.
 */
export function parseMoneyInput(
	text: string,
	locale: string,
	currency: string,
): MoneyInputResult {
	const symbols = numberSymbols(locale);
	const tokens = tokenize(text, symbols).filter((t) => t.kind !== "space");
	if (tokens.length === 0) return { ok: false, error: "empty" };
	if (tokens.some((t) => t.kind === "other")) {
		return { ok: false, error: "invalidCharacter" };
	}
	const decimals = currencyDecimals(currency);
	let value: Ratio;
	try {
		const result = new Evaluator(tokens, symbols).run();
		if (result.moneyDecimals > decimals) throw new InputError("tooPrecise");
		value = result.value;
	} catch (error) {
		if (error instanceof InputError) return { ok: false, error: error.code };
		throw error;
	}
	const scaled = value.n * 10n ** BigInt(decimals);
	const magnitude = roundHalfEven(scaled < 0n ? -scaled : scaled, value.d);
	if (magnitude === 0n) return { ok: false, error: "zero" };
	if (scaled < 0n) return { ok: false, error: "negative" };
	if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) {
		return { ok: false, error: "outOfRange" };
	}
	const expression = tokens.some((t) => t.kind !== "number");
	return { ok: true, minor: Number(magnitude), expression };
}
