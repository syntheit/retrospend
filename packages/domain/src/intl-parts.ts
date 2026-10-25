/**
 * Number parts for the formatter, on every JavaScript engine.
 *
 * Hermes on iOS ships Intl.NumberFormat without formatToParts. partsOf uses
 * the real method where it exists and rebuilds the parts from format() where
 * it does not. The fallback covers what this package asks for: separators,
 * signs, currency, percent and compact notation. The golden vectors run
 * through both paths (vectors/money-vectors.test.ts), so a change to either
 * one that moves a result fails in CI.
 */

type Mode = "auto" | "fallback";
let mode: Mode = "auto";

/** Tests only: force the fallback path. Callers clear their own caches. */
export function setPartsMode(next: Mode): void {
	mode = next;
}

const DIGIT = /\p{Nd}/u;
const SPACE = /\s/u;
const MERGED = new Set([
	"integer",
	"fraction",
	"literal",
	"currency",
	"compact",
]);

function separatorsOf(locale: string, numberingSystem: string) {
	const probe = (n: number) =>
		new Intl.NumberFormat(locale, { numberingSystem }).format(n);
	const between = (text: string) =>
		Array.from(text).find((c, i) => i >= 1 && !DIGIT.test(c)) ?? "";
	return { decimal: between(probe(1.5)), group: between(probe(1234567)) };
}

/** formatToParts rebuilt from format(); exported for the vector tests. */
export function partsFromFormat(
	format: Intl.NumberFormat,
	value: number,
): Intl.NumberFormatPart[] {
	const options =
		format.resolvedOptions() as Intl.ResolvedNumberFormatOptions & {
			notation?: string;
		};
	const { decimal, group } = separatorsOf(
		options.locale,
		options.numberingSystem,
	);
	const chars = Array.from(format.format(value));
	const parts: Intl.NumberFormatPart[] = [];
	let seenDecimal = false;
	const push = (type: string, text: string) => {
		const last = parts[parts.length - 1];
		if (last && last.type === type && MERGED.has(type)) {
			last.value += text;
		} else {
			parts.push({ type, value: text } as Intl.NumberFormatPart);
		}
	};
	const digitAt = (i: number) => DIGIT.test(chars[i] ?? "");

	chars.forEach((char, i) => {
		if (DIGIT.test(char)) {
			push(seenDecimal ? "fraction" : "integer", char);
		} else if (char === decimal && !seenDecimal && digitAt(i + 1)) {
			seenDecimal = true;
			push("decimal", char);
		} else if (char === group && digitAt(i - 1) && digitAt(i + 1)) {
			push("group", char);
		} else if (char === "-" || char === "−") {
			push("minusSign", char);
		} else if (char === "+") {
			push("plusSign", char);
		} else if (char === "%") {
			push("percentSign", char);
		} else if (SPACE.test(char)) {
			push("literal", char);
		} else if (options.notation === "compact") {
			push("compact", char);
		} else if (options.style === "currency") {
			push("currency", char);
		} else {
			push("literal", char);
		}
	});
	return parts;
}

export function partsOf(
	format: Intl.NumberFormat,
	value: number,
): Intl.NumberFormatPart[] {
	if (mode === "auto" && typeof format.formatToParts === "function") {
		return format.formatToParts(value);
	}
	return partsFromFormat(format, value);
}
