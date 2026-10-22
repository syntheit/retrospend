import { expect, type Page, test } from "@playwright/test";
import { gotoReady } from "./helpers/navigation";

// The page title is the level 1 heading; "Category Budgets" also contains "Budget".
const title = (page: Page) =>
	page.getByRole("main").getByRole("heading", { name: "Budget", level: 1 });

test.describe("budget", () => {
	test("budget page loads", async ({ page }) => {
		await gotoReady(page, "/budget");
		await expect(title(page)).toBeVisible();
		await expect(page.getByRole("main").getByText(/error/i)).toHaveCount(0);
	});

	test("budget page shows the category budgets section", async ({ page }) => {
		await gotoReady(page, "/budget");
		await expect(title(page)).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Category Budgets", level: 2 }),
		).toBeVisible();
	});

	test("navigating month backward and forward works", async ({ page }) => {
		await gotoReady(page, "/budget");
		const main = page.getByRole("main");
		// The month label ("Oct 26") sits between the two stepper buttons.
		const month = main.getByRole("button", { name: /^[A-Z][a-z]{2} \d{2}$/ });
		const current = (await month.textContent())?.trim() ?? "";

		await main.getByRole("button", { name: "Previous month" }).click();
		await expect(month).not.toHaveText(current);
		await expect(title(page)).toBeVisible();

		await main.getByRole("button", { name: "Next month" }).click();
		await expect(month).toHaveText(current);
	});
});
