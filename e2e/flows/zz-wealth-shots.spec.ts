import { expect, test } from "@playwright/test";
import { personaStorageState } from "../constants";
import { SOFIA } from "../fixtures/personas";
import { gotoReady } from "../helpers/navigation";

test.use({ storageState: personaStorageState(SOFIA.username) });

const OUT =
	"/home/matv/Projects/retrospend/docs/ui-overhaul/impl/shots/polish/wealth";

for (const scheme of ["light", "dark"] as const) {
	for (const [w, h] of [
		[1440, 900],
		[390, 844],
	] as const) {
		test(`shots ${w} ${scheme}`, async ({ page }) => {
			test.setTimeout(120_000);
			await page.addInitScript((s) => {
				localStorage.setItem("theme-preference", s);
			}, scheme);
			await page.emulateMedia({ colorScheme: scheme });
			await page.setViewportSize({ width: w, height: h });
			await gotoReady(page, "/wealth");
			const main = page.getByRole("main");
			await expect(main.getByRole("slider")).toBeVisible();
			await page.screenshot({ path: `${OUT}/after-${w}-${scheme}-value.png` });

			// Scrub: the cursor, the date and the value.
			const chart = main.getByRole("slider");
			await chart.focus();
			for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
			await page.screenshot({ path: `${OUT}/after-${w}-${scheme}-scrub-keys.png` });
			if (w === 1440) {
				const box = await chart.boundingBox();
				if (box) {
					await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
					await page.mouse.move(box.x + box.width * 0.45, box.y + box.height / 2);
					await page.screenshot({
						path: `${OUT}/after-${w}-${scheme}-scrub-mouse.png`,
					});
				}
			}
			await page.keyboard.press("Escape");

			// The sort menu, then Custom with its grips.
			await main.getByRole("button", { name: /^Sort:/ }).click();
			await page.screenshot({ path: `${OUT}/after-${w}-${scheme}-sort-menu.png` });
			await page.getByRole("menuitem", { name: "Custom order" }).click();
			await expect(main.getByRole("button", { name: /^Reorder / }).first()).toBeVisible();
			await main
				.getByRole("heading", { name: "Cash and bank" })
				.scrollIntoViewIfNeeded();
			await page.screenshot({ path: `${OUT}/after-${w}-${scheme}-custom.png` });
			// Put the seeded view back.
			await main.getByRole("button", { name: /^Sort:/ }).click();
			await page.getByRole("menuitem", { name: "Value" }).click();
			await expect(main.getByRole("button", { name: /^Sort: Value/ })).toBeVisible();
		});
	}
}
