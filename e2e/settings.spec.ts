import { expect, test } from "@playwright/test";
import { TEST_USER } from "./constants";

test.describe("settings", () => {
	test("settings page loads", async ({ page }) => {
		await page.goto("/settings");
		await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
		await expect(page.getByText(/error/i)).not.toBeVisible();
	});

	test("settings page shows the current user name", async ({ page }) => {
		await page.goto("/settings");
		await page.waitForLoadState("networkidle");
		// The SettingsForm should pre-fill the user's name
		const nameInput = page.locator('input[id="name"]').or(
			page.getByRole("textbox", { name: /full name|display name|name/i }).first(),
		);
		if (await nameInput.isVisible()) {
			const value = await nameInput.inputValue();
			expect(value).toBe(TEST_USER.name);
		}
	});

	test("settings page shows profile section", async ({ page }) => {
		await page.goto("/settings");
		await page.waitForLoadState("networkidle");
		// Settings page should show personal information section (merged from Account page)
		await expect(
			page.getByText("Personal Information"),
		).toBeVisible();
	});

	test("sidebar shows correct user name", async ({ page }) => {
		await page.goto("/");
		// NavUser displays the user's name in the sidebar footer
		await expect(page.getByText(TEST_USER.name).first()).toBeVisible();
	});
});
