import type { Page, PlaywrightTestOptions } from "@playwright/test";

/**
 * The visual matrix (IMPLEMENTATION §7.5): light and dark, 1440 and 390.
 * Baselines live in e2e/visual/__screenshots__ and were rendered in the
 * pinned Playwright Docker image; they change only in PRs that say why.
 */
export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const WIDTHS = [1440, 390] as const;
export type Width = (typeof WIDTHS)[number];

/** Context options per width. 390 is a touch phone, so hover styles stay off. */
export function contextFor(
	width: Width,
	theme: Theme,
): Partial<PlaywrightTestOptions> {
	const phone = width === 390;
	return {
		viewport: { width, height: phone ? 844 : 900 },
		isMobile: phone,
		hasTouch: phone,
		deviceScaleFactor: 1,
		colorScheme: theme,
	};
}

/**
 * The app reads its theme from localStorage before hydration (ThemeScript),
 * so set it before any page script runs.
 */
export async function useTheme(page: Page, theme: Theme): Promise<void> {
	await page.addInitScript((t) => {
		localStorage.setItem("theme-preference", t);
	}, theme);
}

/** A screenshot name: `<group>/<what>-<theme>-<width>.png`. */
export function shotName(
	group: string,
	what: string,
	theme: Theme,
	width: Width,
): string[] {
	return [group, `${what}-${theme}-${width}.png`];
}
