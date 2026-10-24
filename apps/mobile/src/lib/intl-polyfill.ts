// Hermes on iOS ships Intl.NumberFormat without formatToParts, and the domain
// money formatter and the money keypad read separators and affixes through
// it. This adds formatToParts, built from `format()`, only where it is
// missing (Android's Hermes has it). It covers the shapes the domain package
// asks for: separators, signs, currency, percent and compact notation. Keep
// it in step with packages/domain/src/format-locale.ts; the test compares it
// with the real formatToParts on Node.

interface Part {
	type: string;
	value: string;
}

type ResolvedOptions = Intl.ResolvedNumberFormatOptions & {
	notation?: string;
};

const DIGIT = /\p{Nd}/u;
const SPACE = /\s/u;

function separatorsOf(locale: string, numberingSystem: string) {
	const probe = (n: number) =>
		new Intl.NumberFormat(locale, { numberingSystem }).format(n);
	const between = (text: string, from: number) =>
		Array.from(text).find((c, i) => i >= from && !DIGIT.test(c)) ?? "";
	const decimal = between(probe(1.5), 1);
	const group = between(probe(1234567), 1);
	return { decimal, group };
}

export function formatToPartsFallback(
	format: Intl.NumberFormat,
	value: number,
): Part[] {
	const options = format.resolvedOptions() as ResolvedOptions;
	const { decimal, group } = separatorsOf(
		options.locale,
		options.numberingSystem,
	);
	const chars = Array.from(format.format(value));
	const parts: Part[] = [];
	let seenDecimal = false;
	const push = (type: string, text: string) => {
		const last = parts[parts.length - 1];
		if (
			last &&
			last.type === type &&
			(type === "integer" ||
				type === "fraction" ||
				type === "literal" ||
				type === "currency" ||
				type === "compact")
		) {
			last.value += text;
		} else {
			parts.push({ type, value: text });
		}
	};
	const isDigitAt = (i: number) => DIGIT.test(chars[i] ?? "");

	chars.forEach((char, i) => {
		if (DIGIT.test(char)) {
			push(seenDecimal ? "fraction" : "integer", char);
		} else if (char === decimal && !seenDecimal && isDigitAt(i + 1)) {
			seenDecimal = true;
			parts.push({ type: "decimal", value: char });
		} else if (char === group && isDigitAt(i - 1) && isDigitAt(i + 1)) {
			parts.push({ type: "group", value: char });
		} else if (char === "-" || char === "−") {
			parts.push({ type: "minusSign", value: char });
		} else if (char === "+") {
			parts.push({ type: "plusSign", value: char });
		} else if (char === "%") {
			parts.push({ type: "percentSign", value: char });
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

export function installNumberFormatToParts(): void {
	const proto = Intl.NumberFormat.prototype as unknown as {
		formatToParts?: unknown;
	};
	if (typeof proto.formatToParts === "function") return;
	proto.formatToParts = function formatToParts(
		this: Intl.NumberFormat,
		value: number,
	) {
		return formatToPartsFallback(this, value);
	};
}
