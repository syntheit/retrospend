/**
 * The progress of a bank statement job as a stable code (E2EE D11 Revision 3,
 * PR 5). The sidecar streams fixed English phrases, some with page or batch
 * numbers; the queue stored them as `statusMessage`. A phrase is now stored
 * as a code only when it is on this list, so the column never holds text the
 * sidecar or a file put there, and it stays unsealed. An unknown phrase
 * stores null.
 *
 * `progressText` is the other way, for API v1's `message`: a code renders as
 * the phrase the sidecar sent, and a value that is not a code (a row from
 * before the codes, which holds that same English phrase) passes through
 * until D12 rewrites it.
 */

interface Shape {
	/** The stored code for the numbers, e.g. `parsing_pages:1-3`. */
	code: (n: string[]) => string;
	/** The phrase with the numbers. */
	text: (n: string[]) => string;
	/** Matches the phrase (the sidecar's own) and captures the numbers. */
	phrase: RegExp;
	/** Matches the code and captures the same numbers. */
	stored: RegExp;
}

const N = "(\\d{1,6})";

const FIXED: ReadonlyArray<readonly [code: string, text: string]> = [
	["reading", "Extracting text from PDF..."],
	["detecting", "Detecting CSV format..."],
	["parsing", "Parsing transactions..."],
	["parsing_statement", "Parsing bank statement..."],
	["enriching", "Enriching transactions..."],
	["complete", "Complete"],
];

const WITH_NUMBERS: readonly Shape[] = [
	{
		code: ([a, b]) => `parsing_pages:${a}-${b}`,
		text: ([a, b]) => `Parsing bank statement (pages ${a}-${b})...`,
		phrase: new RegExp(
			`^Parsing bank statement \\(pages ${N}-${N}\\)\\.\\.\\.$`,
		),
		stored: new RegExp(`^parsing_pages:${N}-${N}$`),
	},
	{
		code: ([a, b]) => `parsing_chunks:${a}/${b}`,
		text: ([a, b]) => `Parsing bank statement (${a}/${b} chunks)...`,
		phrase: new RegExp(
			`^Parsing bank statement \\(${N}/${N} chunks\\)\\.\\.\\.$`,
		),
		stored: new RegExp(`^parsing_chunks:${N}/${N}$`),
	},
	{
		code: ([a, b]) => `enriching_batch:${a}/${b}`,
		text: ([a, b]) => `Enriching transactions (batch ${a}/${b})...`,
		phrase: new RegExp(
			`^Enriching transactions \\(batch ${N}/${N}\\)\\.\\.\\.$`,
		),
		stored: new RegExp(`^enriching_batch:${N}/${N}$`),
	},
];

const numbers = (m: RegExpExecArray) => m.slice(1);

/** The code for a phrase the sidecar sent, or null when it is not one of them. */
export function progressCode(message: unknown): string | null {
	if (typeof message !== "string") return null;
	const fixed = FIXED.find(([, text]) => text === message);
	if (fixed) return fixed[0];
	for (const shape of WITH_NUMBERS) {
		const m = shape.phrase.exec(message);
		if (m) return shape.code(numbers(m));
	}
	return null;
}

/** The phrase for a stored value: a known code as its phrase, anything else as stored. */
export function progressText(stored: string | null): string | null {
	if (stored === null) return null;
	const fixed = FIXED.find(([code]) => code === stored);
	if (fixed) return fixed[1];
	for (const shape of WITH_NUMBERS) {
		const m = shape.stored.exec(stored);
		if (m) return shape.text(numbers(m));
	}
	return stored;
}
