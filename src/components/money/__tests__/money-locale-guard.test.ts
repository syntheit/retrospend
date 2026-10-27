import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { withNumberFormat } from "@retrospend/domain/format-locale";
import { formatMoneyDraft, parseMoneyInput } from "@retrospend/domain/parse";
import { describe, expect, it } from "vitest";

/**
 * Amounts are formatted and typed in the money locale (useMoneyLocale: the
 * page language plus the account's number format). A value from useLocale()
 * is the language alone, so reaching one of these functions it would read
 * "1.500" typed under dot_comma as 1.50. This fails when a file hands its
 * useLocale() value to the money formatter or parsers.
 */
const MONEY_CALLS = [
	"parseMoneyInput",
	"draftFromMinor",
	"formatMoneyDraft",
	"formatMoney",
	"formatMoneyPair",
	"formatPercent",
	"minorOf",
	"readConvQuery",
	"decimalSeparator",
	"groupSeparator",
	"readRateText",
	"numberSymbols",
];

const SRC = join(import.meta.dirname, "..", "..", "..");

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			return entry.name === "node_modules" || entry.name === "__tests__"
				? []
				: sourceFiles(path);
		}
		return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
			? [path]
			: [];
	});
}

/** The text between the parentheses opened at `open`. */
function argsAt(text: string, open: number): string {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (text[i] === "(") depth++;
		else if (text[i] === ")" && --depth === 0) return text.slice(open, i);
	}
	return text.slice(open);
}

/** Calls in `text` that pass `name` to one of the money functions or a hook. */
export function languageLocaleHits(text: string): string[] {
	const names = [...text.matchAll(/const (\w+) = useLocale\(\)/g)].map(
		(m) => m[1] as string,
	);
	const hits: string[] = [];
	for (const name of names) {
		for (const call of MONEY_CALLS) {
			for (const m of text.matchAll(new RegExp(`\\b${call}\\(`, "g"))) {
				const args = argsAt(text, m.index + m[0].length - 1);
				if (new RegExp(`\\b${name}\\b`).test(args)) hits.push(`${call}(${name})`);
			}
		}
	}
	// A hook that takes the locale as an argument (useSetup(locale)) is the
	// same hand-off one step removed.
	for (const name of names) {
		for (const m of text.matchAll(/\buse[A-Z]\w*\(([^()]*)\)/g)) {
			const args = (m[1] ?? "").split(",").map((a) => a.trim());
			if (args.includes(name)) hits.push(`${m[0].split("(")[0]}(${name})`);
		}
	}
	return hits;
}

describe("money locale guard", () => {
	it("spots a language locale reaching the money parsers", () => {
		const bad = `const locale = useLocale();
			const r = parseMoneyInput(text, locale, "USD");
			const s = formatMoney(value, { locale });`;
		expect(languageLocaleHits(bad)).toEqual([
			"parseMoneyInput(locale)",
			"formatMoney(locale)",
		]);
		expect(
			languageLocaleHits(`const locale = useLocale();
				const s = useSetup(locale);`),
		).toEqual(["useSetup(locale)"]);
		expect(
			languageLocaleHits(`const locale = useMoneyLocale();
				parseMoneyInput(text, locale, "USD");`),
		).toEqual([]);
	});

	it("budget setup: typed 1500 under dot_comma is USD 1,500, not 1.50", () => {
		const money = withNumberFormat("en", "dot_comma");
		const typed = formatMoneyDraft("1500", money, "USD");
		expect(typed).toBe("1.500");
		expect(parseMoneyInput(typed, money, "USD")).toMatchObject({
			ok: true,
			minor: 150000,
		});
		// Read in the language alone (the old setup sheet), it is a cent amount.
		expect(parseMoneyInput(typed, "en", "USD")).not.toMatchObject({
			minor: 150000,
		});
		const sheet = readFileSync(
			join(SRC, "features", "budget", "sheets", "setup-sheet.tsx"),
			"utf8",
		);
		expect(sheet).toContain("useMoneyLocale()");
		expect(sheet).not.toContain("useLocale()");
	});

	it("no file hands useLocale() to the money formatter or parsers", () => {
		const offenders = sourceFiles(SRC).flatMap((file) => {
			// The public pay page has no signed-in account, so no number format.
			if (relative(SRC, file).startsWith(join("app", "(site)", "pay"))) return [];
			const hits = languageLocaleHits(readFileSync(file, "utf8"));
			return hits.length ? [`${relative(SRC, file)}: ${hits.join(", ")}`] : [];
		});
		expect(offenders, "use useMoneyLocale() for amounts").toEqual([]);
	});
});
