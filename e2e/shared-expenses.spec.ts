import { expect, test } from "@playwright/test";
import { attemptTitle } from "./helpers/attempt";
import { gotoReady } from "./helpers/navigation";
import { untilSaved } from "./helpers/trpc";

test.describe("projects", () => {
	test("projects page loads", async ({ page }) => {
		await gotoReady(page, "/projects");
		await expect(
			page.getByRole("heading", { name: "Projects", level: 1 }),
		).toBeVisible();
		await expect(page.getByRole("main").getByText(/error/i)).toHaveCount(0);
	});

	test("create a new project", async ({ page }) => {
		const name = attemptTitle("E2E Test Trip");
		await gotoReady(page, "/projects");
		// The toolbar's New Project comes first; an empty list repeats it below.
		await page
			.getByRole("main")
			.getByRole("button", { name: "New Project", exact: true })
			.first()
			.click();

		const dialog = page
			.getByRole("dialog")
			.filter({ has: page.getByRole("button", { name: "Create Project" }) });
		await dialog.getByRole("textbox", { name: "Name" }).fill(name);
		await untilSaved(page, "project.create", () =>
			dialog.getByRole("button", { name: "Create Project" }).click(),
		);
		await expect(dialog).toBeHidden();

		await gotoReady(page, "/projects");
		await expect(
			page.getByRole("main").getByText(name, { exact: true }),
		).toBeVisible();
	});
});

test.describe("people", () => {
	test("people page loads", async ({ page }) => {
		await gotoReady(page, "/people");
		await expect(
			page.getByRole("heading", { name: "People", level: 1 }),
		).toBeVisible();
		await expect(page.getByRole("main").getByText(/error/i)).toHaveCount(0);
	});
});
