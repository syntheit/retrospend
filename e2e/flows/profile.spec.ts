import { expect, test } from "@playwright/test";
import { personaStorageState } from "../constants";
import { SOFIA } from "../fixtures/personas";
import { bannedOutputOn } from "../helpers/banned-output";
import { gotoReady } from "../helpers/navigation";

// Your profile (own page, not a Settings section), in Sofía's saved session.
test.use({ storageState: personaStorageState(SOFIA.username) });

test.describe("Your profile", () => {
	test("shows the identity, the public page and the way to Security", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await gotoReady(page, "/profile");

		const main = page.getByRole("main");
		await expect(main.getByRole("heading", { level: 1 })).toHaveText("Profile");
		// Labels name their fields.
		await expect(page.getByLabel("Display name")).toHaveValue(SOFIA.name);
		await expect(page.getByLabel("Username")).toHaveValue(SOFIA.username);
		await expect(main.getByText(SOFIA.email)).toBeVisible();
		await expect(main.getByText("Member since")).toBeVisible();
		await expect(
			main.getByRole("button", { name: "Change photo" }),
		).toBeVisible();
		await expect(
			main.getByRole("link", { name: new RegExp(`/u/${SOFIA.username}$`) }),
		).toBeVisible();
		await expect(main.getByText("Anyone with the link")).toBeVisible();

		// The background sheet opens from here.
		await main.getByRole("button", { name: "Edit" }).click();
		await expect(
			page.getByRole("dialog", { name: "Profile background" }),
		).toBeVisible();
		await page.keyboard.press("Escape");

		// Security and Sessions stay in Settings.
		await main.getByRole("link", { name: "Open" }).first().click();
		await expect(page).toHaveURL(/\/settings#security$/);
		expect(await bannedOutputOn(page), "banned output").toEqual([]);
	});

	test("Settings no longer carries the profile fields", async ({ page }) => {
		await gotoReady(page, "/settings");
		await expect(page.getByLabel("Display name")).toHaveCount(0);
	});

	test("the account menu opens it", async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await gotoReady(page, "/home");
		await page.getByRole("button", { name: new RegExp(SOFIA.name) }).click();
		await page.getByRole("menuitem", { name: "Your profile" }).click();
		await expect(page).toHaveURL(/\/profile$/);
	});
});
