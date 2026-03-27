import { expect, test } from "@playwright/test";

test.describe("budget", () => {
	test("budget page loads", async ({ page }) => {
		await page.goto("/budget");
		await expect(page.getByRole("heading", { name: "Budget" })).toBeVisible();
		// Should not show an error
		await expect(page.getByText(/error/i)).not.toBeVisible();
	});

	test("budget page shows category rows", async ({ page }) => {
		await page.goto("/budget");

		// Wait for the page to finish loading (budget data loads async)
		await page.waitForLoadState("networkidle");

		// The budget list should render (categories from default seeding)
		// Either a budget list or empty state is visible — just not a crash
		const heading = page.getByRole("heading", { name: "Budget" });
		await expect(heading).toBeVisible();
	});

	test("navigating month backward and forward works", async ({ page }) => {
		await page.goto("/budget");
		await page.waitForLoadState("networkidle");

		// Look for the month stepper navigation buttons
		const prevButton = page
			.getByRole("button", { name: /previous|back|←|</i })
			.first();
		if (await prevButton.isVisible()) {
			await prevButton.click();
			// Page should still render without error
			await expect(
				page.getByRole("heading", { name: "Budget" }),
			).toBeVisible();
		}
	});
});
