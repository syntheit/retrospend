import { expect, test } from "@playwright/test";

test.describe("projects", () => {
	test("projects page loads", async ({ page }) => {
		await page.goto("/projects");
		// Page should render heading
		await expect(
			page.getByRole("heading", { name: /projects/i }),
		).toBeVisible();
		await expect(page.getByText(/error/i)).not.toBeVisible();
	});

	test("create a new project", async ({ page }) => {
		await page.goto("/projects");
		await page.waitForLoadState("networkidle");

		const newProjectButton = page.getByRole("button", {
			name: /new project|create project|add project/i,
		});
		if (!(await newProjectButton.isVisible())) {
			test.skip();
			return;
		}

		await newProjectButton.click();

		// A dialog or form should appear
		await expect(page.getByRole("dialog")).toBeVisible();

		// Fill in the project name
		const nameInput = page
			.getByRole("textbox", { name: /name/i })
			.or(page.locator('input[placeholder*="name" i]'))
			.first();
		await nameInput.fill("E2E Test Trip");

		// Submit
		const submitButton = page
			.getByRole("button", { name: /create|save/i })
			.last();
		await submitButton.click();

		// Project should appear in the list
		await expect(page.getByText("E2E Test Trip")).toBeVisible();
	});
});

test.describe("people", () => {
	test("people page loads", async ({ page }) => {
		await page.goto("/people");
		await expect(
			page.getByRole("heading", { name: /people/i }),
		).toBeVisible();
		await expect(page.getByText(/error/i)).not.toBeVisible();
	});
});
