import { expect, type Page, test } from "@playwright/test";

// The page title is the level 1 heading; the empty state also says "Wealth".
const title = (page: Page) =>
	page.getByRole("main").getByRole("heading", { name: "Wealth", level: 1 });

test.describe("wealth", () => {
	test("wealth page loads", async ({ page }) => {
		await page.goto("/wealth");
		await expect(title(page)).toBeVisible();
		await expect(page.getByRole("main").getByText(/error/i)).toHaveCount(0);
	});

	test("wealth page shows the empty net worth state", async ({ page }) => {
		await page.goto("/wealth");
		await expect(title(page)).toBeVisible();
		// The test user has no accounts yet.
		await expect(
			page.getByRole("heading", { name: "No Wealth Data Yet" }),
		).toBeVisible();
	});

	test("add asset opens the form", async ({ page }) => {
		await page.goto("/wealth");
		await page
			.getByRole("main")
			.getByRole("button", { name: "Add Asset", exact: true })
			.click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
	});
});
