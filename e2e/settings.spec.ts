import { expect, test } from "@playwright/test";
import { TEST_USER } from "./constants";
import { gotoReady } from "./helpers/navigation";

test.describe("settings", () => {
	test("settings page loads", async ({ page }) => {
		await gotoReady(page, "/settings");
		await expect(
			page.getByRole("heading", { name: "Settings", level: 1 }),
		).toBeVisible();
		await expect(page.getByRole("main").getByText(/error/i)).toHaveCount(0);
	});

	test("settings page shows the current user name", async ({ page }) => {
		await gotoReady(page, "/settings");
		// The profile form pre-fills the user's name. Its "Display name" label
		// points at id="name" while the input gets a generated id, so the
		// field has no accessible name to select it by (see docs/ui/GAPS.md).
		await expect(page.locator('#profile-form input[name="name"]')).toHaveValue(
			TEST_USER.name,
		);
	});

	test("settings page shows profile section", async ({ page }) => {
		await gotoReady(page, "/settings");
		// Personal information (merged from the old Account page)
		await expect(
			page.getByRole("main").getByText("Personal Information", { exact: true }),
		).toBeVisible();
	});

	test("sidebar shows correct user name", async ({ page }) => {
		await gotoReady(page, "/dashboard");
		// NavUser shows the user's name in the sidebar footer
		await expect(page.getByRole("button", { name: "User menu" })).toContainText(
			TEST_USER.name,
		);
	});
});
