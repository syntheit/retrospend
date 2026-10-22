/**
 * Text no page may ever show (IMPLEMENTATION §7.4, SYNTHESIS-r5 §6 item 6):
 * NaN, Infinity, a doubled sign such as "+−", a percent above 1000%, and the
 * "No project" phantom (a balance line for a project that does not exist).
 * Checked against the visible text of every page a test visits.
 */
import type { Page } from "@playwright/test";
import { findShownNumbers, shownAbove } from "./numbers";

const PERCENT_LIMIT = 1000;

const BANNED: { label: string; pattern: RegExp }[] = [
	{ label: "NaN", pattern: /\bNaN\b/g },
	{ label: "Infinity", pattern: /\bInfinity\b|∞/g },
	// "+−", "−+", "+-" glued before an amount: a sign added to a signed
	// number. A symbol picker's "+ − × ÷" is fine.
	{
		label: "doubled sign",
		pattern: /(?:\+[−-]|[−-]\+)(?=\s?[\p{Sc}A-Z]{0,4}\s?\d)/gu,
	},
	// The "No project" phantom; "No projects yet" style copy is fine.
	{
		label: "No project phantom",
		pattern: /\bNo project\b(?!s)|\bSin proyecto\b(?!s)/gi,
	},
];

function snippet(text: string, index: number, length: number): string {
	const start = Math.max(0, index - 30);
	const end = Math.min(text.length, index + length + 30);
	return text.slice(start, end).replace(/\s+/g, " ").trim();
}

/** Every banned piece of text, with some context around it. */
export function findBannedOutput(text: string, locale: string): string[] {
	const found: string[] = [];
	for (const { label, pattern } of BANNED) {
		for (const match of text.matchAll(pattern)) {
			found.push(`${label}: "${snippet(text, match.index, match[0].length)}"`);
		}
	}
	for (const shown of findShownNumbers(text, locale)) {
		if (shown.percent && shownAbove(shown, PERCENT_LIMIT)) {
			found.push(`percent above ${PERCENT_LIMIT}%: "${shown.raw}"`);
		}
	}
	return found;
}

/** Banned text in what the page shows right now (visible text and the title). */
export async function bannedOutputOn(page: Page): Promise<string[]> {
	const { text, locale } = await page.evaluate(() => ({
		text: `${document.title}\n${document.body.innerText}`,
		locale: document.documentElement.lang || "en-US",
	}));
	return findBannedOutput(text, locale);
}
