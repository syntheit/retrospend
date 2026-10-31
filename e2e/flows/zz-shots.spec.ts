import { type Page, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE, personaStorageState } from "../constants";
import { SOFIA } from "../fixtures/personas";
import { gotoReady } from "../helpers/navigation";

const OUT = process.env.SHOT_DIR ?? "/tmp/shots";
const PHASE = process.env.SHOT_PHASE ?? "after";
const PAGES = (process.env.SHOT_PAGES ?? "admin,profile").split(",");

async function shoot(page: Page, name: string, url: string, full = true) {
	for (const scheme of ["light", "dark"] as const) {
		for (const width of [1440, 390]) {
			await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
			await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
			await gotoReady(page, url);
			await page.waitForTimeout(800);
			await page.screenshot({
				path: `${OUT}/${PHASE}-${name}-${width}-${scheme}.png`,
				fullPage: full,
			});
		}
	}
}

test.describe("shots", () => {
	test.setTimeout(300_000);
	test.describe("admin", () => {
		test.use({ storageState: ADMIN_STORAGE_STATE });
		test("admin", async ({ page }) => {
			test.skip(!PAGES.includes("admin"));
			await shoot(page, "admin", "/admin");
			for (const tab of (process.env.SHOT_TABS ?? "")
				.split(",")
				.filter(Boolean))
				await shoot(page, `admin-${tab}`, `/admin#${tab}`);
		});
	});
	test.describe("profile", () => {
		test.use({ storageState: personaStorageState(SOFIA.username) });
		test("profile", async ({ page }) => {
			test.skip(!PAGES.includes("profile"));
			await shoot(
				page,
				"profile",
				process.env.SHOT_PROFILE_URL ?? "/settings#profile",
			);
		});
	});
});
