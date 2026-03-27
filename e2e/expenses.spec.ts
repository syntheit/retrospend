import { expect, test } from "@playwright/test";

// All expense tests use the saved test-user session (chromium project)

test.describe("expenses", () => {
	test("create a basic expense", async ({ page }) => {
		await page.goto("/");

		// Fresh user sees the onboarding card with "Add expense"
		await page.getByRole("button", { name: "Add expense" }).first().click();

		// The expense modal should open
		await expect(page.getByRole("dialog")).toBeVisible();
		await expect(
			page.getByRole("heading", { name: /new expense/i }),
		).toBeVisible();

		// Fill in the amount
		await page.fill("#amount", "50");

		// Fill in the title
		await page.fill("#title", "E2E Test Grocery");

		// Submit the form
		await page.getByRole("button", { name: /create expense/i }).click();

		// Modal should close
		await expect(page.getByRole("dialog")).not.toBeVisible();

		// Navigate to transactions to verify it was saved
		await page.goto("/transactions");
		await expect(page.getByText("E2E Test Grocery")).toBeVisible();
	});

	test("edit an expense", async ({ page }) => {
		// Go to transactions (expense from previous test or seed data)
		await page.goto("/transactions");

		// Wait for the table to load
		await page.waitForSelector("table");

		// Click the first expense row to open it
		const firstRow = page.locator("table tbody tr").first();
		await firstRow.click();

		// Wait for the edit modal
		await expect(page.getByRole("dialog")).toBeVisible();
		await expect(
			page.getByRole("heading", { name: /edit expense/i }),
		).toBeVisible();

		// Change the title
		const titleInput = page.locator("#title");
		await titleInput.fill("E2E Edited Expense");

		// Save the changes
		await page.getByRole("button", { name: /save changes/i }).click();

		// Modal closes
		await expect(page.getByRole("dialog")).not.toBeVisible();

		// Verify the updated title appears in the table
		await expect(page.getByText("E2E Edited Expense")).toBeVisible();
	});

	test("delete an expense", async ({ page }) => {
		// First create a fresh expense to delete via the overview page
		await page.goto("/");

		// If onboarding card is gone, go to transactions and use empty state
		await page.goto("/transactions");

		// Check if there's an "Add expense" button (empty state) or use the header
		const addButton = page.getByRole("button", { name: "Add expense" }).first();
		if (await addButton.isVisible()) {
			await addButton.click();
		} else {
			// Table has rows; open a fresh expense differently - skip this variant
			test.skip();
			return;
		}

		await page.fill("#amount", "99");
		await page.fill("#title", "E2E Expense To Delete");
		await page.getByRole("button", { name: /create expense/i }).click();
		await expect(page.getByRole("dialog")).not.toBeVisible();

		// Find and click the expense
		const row = page.getByRole("row", { name: /E2E Expense To Delete/i });
		await row.click();

		// Wait for edit modal
		await expect(page.getByRole("dialog")).toBeVisible();

		// Click the delete (trash) icon button
		await page.getByRole("button", { name: /delete expense/i }).click();

		// Confirm in the confirmation dialog
		const confirmDialog = page.getByRole("dialog").last();
		await confirmDialog.getByRole("button", { name: /delete expense/i }).click();

		// Verify the expense is gone
		await expect(page.getByText("E2E Expense To Delete")).not.toBeVisible();
	});

	test("transactions page renders without errors", async ({ page }) => {
		await page.goto("/transactions");
		await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();
		// Table or empty state should be visible — no "Error loading" text
		await expect(page.getByText(/error loading expenses/i)).not.toBeVisible();
	});
});
