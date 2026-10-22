import type { Page } from "@playwright/test";

/**
 * Opens `url` and returns once the page answers clicks: React has hydrated
 * the root (HydrationMarker sets html[data-hydrated]) and the first data
 * requests are done. On a cold dev server the first compile can reload the
 * page, which starts a fresh document without the marker, so the wait covers
 * that too.
 */
export async function gotoReady(page: Page, url: string): Promise<void> {
	await page.goto(url);
	await waitUntilReady(page);
}

/** The same wait, for a page reached by a redirect or a form submit. */
export async function waitUntilReady(page: Page): Promise<void> {
	await page
		.locator('html[data-hydrated="true"]')
		.waitFor({ state: "attached" });
	await page.waitForLoadState("networkidle");
}
