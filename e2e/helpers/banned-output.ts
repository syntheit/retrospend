/**
 * Text no page may ever show (IMPLEMENTATION §7.4, SYNTHESIS-r5 §6 item 6):
 * NaN, Infinity, a doubled sign such as "+−" or "−−", a percent above 1000%,
 * and the "No project" phantom (a balance line for a project that does not
 * exist). Checked against the visible text of every page a test visits.
 *
 * Two kinds of text are skipped, because the app did not compute them:
 * - `[aria-hidden="true"]` subtrees: decoration, and everything behind an
 *   open dialog (the dialog is what the user is reading);
 * - `[data-user-text]` elements: text a person typed (expense titles, notes,
 *   names, search terms). An expense called "Infinity pool" or "No project
 *   lunch" is the user's words, not a bug. S4 puts `data-user-text` on every
 *   element that renders such a string, and on nothing else.
 */
import type { Page } from "@playwright/test";
import { findShownNumbers, shownAbove } from "./numbers";

const PERCENT_LIMIT = 1000;

/** Elements whose text the check skips (see the comment above). */
export const SKIPPED_TEXT_SELECTOR = '[aria-hidden="true"], [data-user-text]';

const BANNED: { label: string; pattern: RegExp }[] = [
	{ label: "NaN", pattern: /\bNaN\b/g },
	{ label: "Infinity", pattern: /\bInfinity\b|∞/g },
	// Two signs in a row before an amount ("+−", "−−", "+ −ARS 5"): a sign
	// added to a signed number. Spaces between them count, line breaks do
	// not (a "+" button above a negative amount is fine), and so does a
	// symbol picker's "+ − × ÷" with no amount after it.
	{
		label: "doubled sign",
		pattern: /[+−-][ \t ]*[+−-](?=[ \t ]?[\p{Sc}A-Z]{0,4}[ \t ]?\d)/gu,
	},
	// The "No project" phantom, as the app writes it. "No projects yet" and
	// lowercase prose are fine.
	{
		label: "No project phantom",
		pattern: /\bNo project\b(?!s)|\bSin proyecto\b(?!s)/g,
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

/**
 * The page's visible text without the skipped elements. They are hidden for
 * the length of one synchronous read (innerText follows display: none) and
 * restored before the browser paints.
 */
export async function visibleAppText(
	page: Page,
): Promise<{ text: string; locale: string }> {
	return page.evaluate((skipped) => {
		const hidden = [...document.querySelectorAll<HTMLElement>(skipped)].map(
			(el) => {
				const before = el.style.getPropertyValue("display");
				const priority = el.style.getPropertyPriority("display");
				el.style.setProperty("display", "none", "important");
				return () => el.style.setProperty("display", before, priority);
			},
		);
		try {
			return {
				text: `${document.title}\n${document.body.innerText}`,
				locale: document.documentElement.lang || "en-US",
			};
		} finally {
			for (const restore of hidden) restore();
		}
	}, SKIPPED_TEXT_SELECTOR);
}

/** Banned text in what the page shows right now (visible text and the title). */
export async function bannedOutputOn(page: Page): Promise<string[]> {
	const { text, locale } = await visibleAppText(page);
	return findBannedOutput(text, locale);
}
