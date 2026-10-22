import { expect, test } from "@playwright/test";
import { addExpense, expenseRow, openExpenseDetails } from "./helpers/expenses";

// All expense tests use the saved test-user session (chromium project). Each
// test adds the expense it works on, so none depends on another.

test.describe("expenses", () => {
	test("create a basic expense", async ({ page }) => {
		await page.goto("/dashboard");
		await addExpense(page, { title: "E2E Test Grocery", amount: "50" });

		await page.goto("/transactions");
		await expect(expenseRow(page, "E2E Test Grocery")).toBeVisible();
	});

	test("edit an expense", async ({ page }) => {
		await page.goto("/transactions");
		await addExpense(page, { title: "E2E Expense To Edit", amount: "42" });

		const details = await openExpenseDetails(page, "E2E Expense To Edit");
		await details.getByRole("button", { name: "Edit expense" }).click();

		const editor = page.getByRole("dialog");
		await expect(
			editor.getByRole("button", { name: "Save Changes" }),
		).toBeVisible();
		await editor
			.getByRole("textbox", { name: "Expense Title" })
			.fill("E2E Edited Expense");
		await editor.getByRole("button", { name: "Save Changes" }).click();
		await expect(editor).toBeHidden();

		await expect(expenseRow(page, "E2E Edited Expense")).toBeVisible();
		await expect(expenseRow(page, "E2E Expense To Edit")).toHaveCount(0);
	});

	test("delete an expense", async ({ page }) => {
		await page.goto("/transactions");
		await addExpense(page, { title: "E2E Expense To Delete", amount: "99" });

		const details = await openExpenseDetails(page, "E2E Expense To Delete");
		await details.getByRole("button", { name: "Delete expense" }).click();

		const confirm = page.getByRole("dialog", { name: "Delete Expenses" });
		await confirm.getByRole("button", { name: "Delete Expenses" }).click();
		await expect(confirm).toBeHidden();

		await expect(expenseRow(page, "E2E Expense To Delete")).toHaveCount(0);
	});

	test("transactions page renders without errors", async ({ page }) => {
		await page.goto("/transactions");
		await expect(
			page.getByRole("heading", { name: "Transactions", level: 1 }),
		).toBeVisible();
		await expect(page.getByText(/error loading expenses/i)).toHaveCount(0);
	});
});
