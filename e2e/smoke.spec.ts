import { expect, test } from "@playwright/test";

// Smoke tests run without any auth state
test.describe("smoke", () => {
	test("login page is accessible", async ({ page }) => {
		await page.goto("/login");
		await expect(page).toHaveTitle(/Retrospend/);
		await expect(
			page.getByRole("button", { name: /sign in/i }),
		).toBeVisible();
	});

	test("unauthenticated access to protected routes redirects to login", async ({
		page,
	}) => {
		await page.goto("/transactions");
		await expect(page).toHaveURL(/\/login/);
	});

	test("signup page is accessible", async ({ page }) => {
		await page.goto("/signup");
		await expect(page).toHaveTitle(/Retrospend/);
		await expect(
			page.getByRole("button", { name: /create account/i }),
		).toBeVisible();
	});
});
