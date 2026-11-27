import { expect, test } from "./fixtures/sealed-guard";
import { TEST_USER } from "./constants";
import { loginAsTestUser } from "./helpers/auth";
import { gotoReady } from "./helpers/navigation";

// ── Login / Logout flows ──────────────────────────────────────────────────────

test.describe("login", () => {
	// Each test in this block starts with no session
	test.use({ storageState: { cookies: [], origins: [] } });

	test("login with valid credentials lands on Home", async ({
		page,
	}) => {
		await gotoReady(page, "/login");
		await page.fill("#email", TEST_USER.email);
		await page.fill("#password", TEST_USER.password);
		await page.click('button[type="submit"]');

		await expect(page).toHaveURL(/\/home/);
	});

	test("login with wrong password shows error", async ({ page }) => {
		await gotoReady(page, "/login");
		await page.fill("#email", TEST_USER.email);
		await page.fill("#password", "WrongPassword999!");
		await page.click('button[type="submit"]');

		// Should stay on login page with an error visible
		await expect(page).toHaveURL(/\/login/);
		await expect(page.getByText(/invalid|incorrect|failed/i)).toBeVisible();
	});

	test("login with non-existent email shows error", async ({ page }) => {
		await gotoReady(page, "/login");
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
		// Log in first (returns once Home has hydrated)
		await loginAsTestUser(page);
		await expect(page).toHaveURL(/\/home/);

		// Open the account menu at the bottom of the sidebar
		await page.getByRole("button", { name: /Account menu/ }).click();
		await page.getByRole("menuitem", { name: "Sign out" }).click();

		// Should redirect to login
		await expect(page).toHaveURL(/\/login/);

		// Navigating to a protected route should redirect back to login (session is gone)
		await page.goto("/activity");
		await expect(page).toHaveURL(/\/login/);
	});

	test("logout works when the first-visit locale sync reloads Home late", async ({
		page,
	}) => {
		// A browser with no locale cookie gets one from a server action on its
		// first dashboard page and then reloads (LocaleSync). On a slow machine
		// that action starts after the page has gone quiet and the reload takes
		// a while, so it lands after Home first looked ready. Start the action
		// two seconds late and hold the reloaded document for three.
		await page.addInitScript(() => {
			const original = window.fetch;
			window.fetch = async (input, init) => {
				if (new Headers(init?.headers).has("next-action"))
					await new Promise((resolve) => setTimeout(resolve, 2000));
				return original(input, init);
			};
		});
		let homeDocuments = 0;
		await page.route("**/home", async (route) => {
			if (route.request().isNavigationRequest() && ++homeDocuments === 2)
				await new Promise((resolve) => setTimeout(resolve, 3000));
			await route.continue();
		});

		await loginAsTestUser(page);
		await page.getByRole("button", { name: /Account menu/ }).click();
		// The menu is open and the reload is on its way: wait until the action
		// has answered (it sets the cookie), then use the menu.
		await expect
			.poll(async () =>
				(await page.context().cookies()).some((c) => c.name === "locale"),
			)
			.toBe(true);
		await page.getByRole("menuitem", { name: "Sign out" }).click();
		await expect(page).toHaveURL(/\/login/);
	});
});
