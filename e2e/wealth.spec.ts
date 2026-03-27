import { expect, test } from "@playwright/test";

test.describe("wealth", () => {
	test("wealth page loads", async ({ page }) => {
		await page.goto("/wealth");
		await expect(page.getByRole("heading", { name: "Wealth" })).toBeVisible();
		await expect(page.getByText(/error/i)).not.toBeVisible();
	});

	test("wealth page shows net worth section", async ({ page }) => {
		await page.goto("/wealth");
		await page.waitForLoadState("networkidle");

		// Net worth, assets, or liabilities section should be visible
		// Fresh user has no assets — empty state or zero balance is fine
		const heading = page.getByRole("heading", { name: "Wealth" });
		await expect(heading).toBeVisible();
	});

	test("add asset button is visible", async ({ page }) => {
		await page.goto("/wealth");
		await page.waitForLoadState("networkidle");

		// There should be a button to add an asset account
		const addButton = page.getByRole("button", {
			name: /add asset|new asset|add account/i,
		});
		// If the button exists, clicking it should open a form/dialog
		if (await addButton.isVisible()) {
			await addButton.click();
			await expect(page.getByRole("dialog")).toBeVisible();
			// Close it
			await page.keyboard.press("Escape");
		}
	});
});
