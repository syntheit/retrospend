import { expect, type Locator, type Page } from "@playwright/test";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Adds an expense through the sidebar's Add Expense button (on every
 * signed-in page). Open the page with gotoReady first.
 */
export async function addExpense(
	page: Page,
	expense: { title: string; amount: string; category?: string },
): Promise<void> {
	// The dialog takes the title as its name once one is typed.
	const dialog = page
		.getByRole("dialog")
		.filter({ has: page.getByRole("button", { name: "Create Expense" }) });
	// The sidebar's button sits in a list item; empty states repeat the label in <main>.
	await page
		.getByRole("listitem")
		.getByRole("button", { name: "Add Expense", exact: true })
		.click();
	await expect(dialog).toBeVisible();
	await dialog.getByRole("textbox", { name: "Amount" }).fill(expense.amount);
	await dialog
		.getByRole("textbox", { name: "Expense Title" })
		.fill(expense.title);
	await dialog
		.getByRole("group", { name: "Category" })
		.getByRole("button", { name: expense.category ?? "Groceries", exact: true })
		.click();
	await dialog.getByRole("button", { name: "Create Expense" }).click();
	await expect(dialog).toBeHidden();
}

/** The Transactions table row whose title is `title`. */
export function expenseRow(page: Page, title: string): Locator {
	return page
		.getByRole("main")
		.getByRole("row", { name: new RegExp(`^${escapeRegExp(title)} `) });
}

/** Opens the row's details dialog (its Actions button). */
export async function openExpenseDetails(
	page: Page,
	title: string,
): Promise<Locator> {
	await expenseRow(page, title)
		.getByRole("button", { name: "Actions" })
		.click();
	const details = page.getByRole("dialog", { name: title });
	await expect(details).toBeVisible();
	return details;
}
