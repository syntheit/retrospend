import { expect, type Page, test } from "@playwright/test";
import { Pool } from "pg";
import { E2E_DATABASE_URL } from "../constants";
import { loginAsAdmin } from "../helpers/auth";
import { gotoReady } from "../helpers/navigation";
import {
	contextFor,
	shotName,
	THEMES,
	useTheme,
	WIDTHS,
	type Width,
} from "./matrix";

// The page the shell is shot on. Its content is hidden: the page restyles in
// S4 and should not move the shell baseline. Settings has no seeded data.
const SHELL_PAGE = "/settings";
const HIDE_PAGE = `#main-content > * { visibility: hidden !important; }`;

/**
 * Turns the new shell on for everyone. The seed wiped app_settings, and
 * updatedAt has no database default, hence the explicit now().
 */
async function enableUiV2(): Promise<void> {
	const pool = new Pool({ connectionString: E2E_DATABASE_URL });
	try {
		await pool.query(`
			INSERT INTO "app_settings" ("id", "updatedAt", "uiV2Mode")
			VALUES ('app_settings_singleton', now(), 'ALL')
			ON CONFLICT ("id") DO UPDATE SET "uiV2Mode" = 'ALL'`);
	} finally {
		await pool.end();
	}
}

/** The new shell's own navigation: the sidebar on desktop, the bar on phone. */
function shellNav(page: Page, width: Width) {
	return width === 390
		? page.locator('nav[aria-label="Main"].fixed')
		: page.locator('aside[aria-label="Main"]');
}

test.beforeAll(enableUiV2);

for (const theme of THEMES) {
	for (const width of WIDTHS) {
		test.describe(`shell ${theme} ${width}`, () => {
			test.use(contextFor(width, theme));

			test("the shell matches its baseline", async ({ page }) => {
				// The server caches app settings for up to 60 seconds.
				test.setTimeout(120_000);
				await useTheme(page, theme);
				await loginAsAdmin(page);
				await expect(async () => {
					await gotoReady(page, SHELL_PAGE);
					await expect(shellNav(page, width)).toBeVisible({ timeout: 1000 });
				}).toPass({ intervals: [5000], timeout: 75_000 });
				await page.evaluate(() => document.fonts.ready);

				// Hidden rather than masked: a mask paints over everything in its
				// box, which on a phone includes the floating Add.
				await page.addStyleTag({ content: HIDE_PAGE });
				await expect(page).toHaveScreenshot(
					shotName("shell", "settings", theme, width),
				);
			});
		});
	}
}
