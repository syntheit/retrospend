import { expect, test } from "@playwright/test";
import { attemptTitle } from "./helpers/attempt";
import { addExpense, expenseRow, openExpenseDetails } from "./helpers/expenses";
import { gotoReady } from "./helpers/navigation";

// All expense tests use the saved test-user session (chromium project). Each
// test adds the expense it works on, so none depends on another.

test.describe("expenses", () => {
	test("create a basic expense", async ({ page }) => {
		const title = attemptTitle("E2E Test Grocery");
		await gotoReady(page, "/dashboard");
		await addExpense(page, { title, amount: "50" });

		await gotoReady(page, "/transactions");
		await expect(expenseRow(page, title)).toBeVisible();
	});

	test("edit an expense", async ({ page }) => {
		const before = attemptTitle("E2E Expense To Edit");
		const after = attemptTitle("E2E Edited Expense");
		await gotoReady(page, "/transactions");
		await addExpense(page, { title: before, amount: "42" });

		const details = await openExpenseDetails(page, before);
		await details.getByRole("button", { name: "Edit expense" }).click();

		const editor = page.getByRole("dialog");
		await expect(
			editor.getByRole("button", { name: "Save Changes" }),
		).toBeVisible();
		await editor.getByRole("textbox", { name: "Expense Title" }).fill(after);
		await editor.getByRole("button", { name: "Save Changes" }).click();
		await expect(editor).toBeHidden();

		await expect(expenseRow(page, after)).toBeVisible();
		await expect(expenseRow(page, before)).toHaveCount(0);
	});

	test("delete an expense", async ({ page }) => {
		const title = attemptTitle("E2E Expense To Delete");
		await gotoReady(page, "/transactions");
		await addExpense(page, { title, amount: "99" });

		const details = await openExpenseDetails(page, title);
		await details.getByRole("button", { name: "Delete expense" }).click();

		const confirm = page.getByRole("dialog", { name: "Delete Expenses" });
		await confirm.getByRole("button", { name: "Delete Expenses" }).click();
		await expect(confirm).toBeHidden();

		await expect(expenseRow(page, title)).toHaveCount(0);
	});

	test("transactions page renders without errors", async ({ page }) => {
		await gotoReady(page, "/transactions");
		await expect(
			page.getByRole("heading", { name: "Transactions", level: 1 }),
		).toBeVisible();
		await expect(page.getByText(/error loading expenses/i)).toHaveCount(0);
	});
});
