import { expect, test } from "@playwright/test";

test.describe("projects", () => {
	test("projects page loads", async ({ page }) => {
		await page.goto("/projects");
		await expect(
			page.getByRole("heading", { name: "Projects", level: 1 }),
		).toBeVisible();
		await expect(page.getByRole("main").getByText(/error/i)).toHaveCount(0);
	});

	test("create a new project", async ({ page }) => {
		await page.goto("/projects");
		// The toolbar's New Project comes first; an empty list repeats it below.
		await page
			.getByRole("main")
			.getByRole("button", { name: "New Project", exact: true })
			.first()
			.click();

		const dialog = page.getByRole("dialog", { name: "New Project" });
		await dialog.getByRole("textbox", { name: "Name" }).fill("E2E Test Trip");
		await dialog.getByRole("button", { name: "Create Project" }).click();
		await expect(dialog).toBeHidden();

		await page.goto("/projects");
		await expect(
			page.getByRole("main").getByText("E2E Test Trip", { exact: true }),
		).toBeVisible();
	});
});

test.describe("people", () => {
	test("people page loads", async ({ page }) => {
		await page.goto("/people");
		await expect(
			page.getByRole("heading", { name: "People", level: 1 }),
		).toBeVisible();
		await expect(page.getByRole("main").getByText(/error/i)).toHaveCount(0);
	});
});
