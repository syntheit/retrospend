import { expect, test } from "@playwright/test";
import { personaStorageState } from "../constants";
import { SOFIA } from "../fixtures/personas";
import { gotoReady } from "../helpers/navigation";

// Right-click and the keyboard open the same menu as a row's ⋯ button.

test.use({ storageState: personaStorageState(SOFIA.username) });

test("Wealth account: right-click opens the same menu as the overflow", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await gotoReady(page, "/wealth");
	const row = page
		.getByRole("main")
		.getByRole("listitem")
		.filter({ hasText: "Wise (USD)" });
	await row.click({ button: "right" });
	const menu = page.getByRole("menu");
	await expect(menu).toBeVisible();
	const rightClick = await menu.getByRole("menuitem").allTextContents();
	expect(rightClick.length).toBeGreaterThan(0);
	await page.keyboard.press("Escape");
	await expect(menu).toBeHidden();

	await row.hover();
	await row.getByRole("button", { name: /^More actions/ }).click();
	const overflow = await page
		.getByRole("menu")
		.getByRole("menuitem")
		.allTextContents();
	expect(rightClick).toEqual(overflow);
});

test("Activity row: right-click and Shift+F10 open the menu", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await gotoReady(page, "/activity");
	const row = page.getByRole("row").filter({ hasText: "Recarga SUBE" });
	await row.click({ button: "right" });
	const menu = page.getByRole("menu");
	await expect(menu).toBeVisible();
	await expect(menu.getByRole("menuitem").last()).toContainText(/Delete/);
	await page.keyboard.press("Escape");
	await expect(menu).toBeHidden();

	await row.locator("a, button").first().focus();
	await page.keyboard.press("Shift+F10");
	await expect(page.getByRole("menu")).toBeVisible();
});
