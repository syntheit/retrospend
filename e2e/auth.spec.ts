import { expect, test } from "@playwright/test";
import { TEST_USER } from "./constants";
import { loginAsTestUser } from "./helpers/auth";

// ── Login / Logout flows ──────────────────────────────────────────────────────

test.describe("login", () => {
	// Each test in this block starts with no session
	test.use({ storageState: { cookies: [], origins: [] } });

	test("login with valid credentials redirects to dashboard", async ({
		page,
	}) => {
		await page.goto("/login");
		await page.fill("#email", TEST_USER.email);
		await page.fill("#password", TEST_USER.password);
		await page.click('button[type="submit"]');

		await expect(page).toHaveURL(/\/dashboard/);
	});

	test("login with wrong password shows error", async ({ page }) => {
		await page.goto("/login");
		await page.fill("#email", TEST_USER.email);
		await page.fill("#password", "WrongPassword999!");
		await page.click('button[type="submit"]');

		// Should stay on login page with an error visible
		await expect(page).toHaveURL(/\/login/);
		await expect(page.getByText(/invalid|incorrect|failed/i)).toBeVisible();
	});

	test("login with non-existent email shows error", async ({ page }) => {
		await page.goto("/login");
		await page.fill("#email", "nobody@nowhere.example");
		await page.fill("#password", "AnyPassword123!");
		await page.click('button[type="submit"]');

		await expect(page).toHaveURL(/\/login/);
		await expect(page.getByText(/invalid|incorrect|failed/i)).toBeVisible();
	});
});

test.describe("logout", () => {
	// Logout test starts logged in
	test.use({ storageState: { cookies: [], origins: [] } });

	test("logout redirects to login and clears session", async ({ page }) => {
		// Log in first
		await loginAsTestUser(page);
		await expect(page).toHaveURL(/\/dashboard/);

		// Open the user dropdown in the sidebar
		await page.getByText(TEST_USER.name).first().click();
		await page.getByRole("menuitem", { name: /log out/i }).click();

		// Should redirect to login
		await expect(page).toHaveURL(/\/login/);

		// Navigating to a protected route should redirect back to login (session is gone)
		await page.goto("/transactions");
		await expect(page).toHaveURL(/\/login/);
	});
});
