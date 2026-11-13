import { personaStorageState } from "../constants";
import { SOFIA } from "../fixtures/personas";
import { expect, test } from "../fixtures/sealed-guard";
import { untilSaved } from "../helpers/trpc";
import { openV2 } from "./viewer";

// A row opens a view-only detail pane beside the list (T2); the URL holds it,
// so Back closes it. The pencil opens the edit composer; Delete is in the
// overflow, last, and ends with an Undo toast.

test.use({ storageState: personaStorageState(SOFIA.username) });

test("Activity: an expense opens in a pane, Back closes it, pencil edits, delete undoes", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openV2(page, "/activity?range=all");
	const main = page.getByRole("main");
	const pane = page.getByRole("complementary", { name: "Monotributo" });

	// Open: the pane shows the facts and the list stays beside it.
	await main.getByText("Monotributo").first().click();
	await expect(pane).toBeVisible();
	await expect(page).toHaveURL(/expense=/);
	await expect(pane).toContainText("$42,000");
	await expect(pane).toContainText("Taxes");
	await expect(page.getByRole("dialog")).toHaveCount(0);

	// Back closes it.
	await page.goBack();
	await expect(pane).toBeHidden();
	await expect(page).not.toHaveURL(/expense=/);

	// The pencil opens the existing edit composer.
	await main.getByText("Monotributo").first().click();
	await pane.getByRole("button", { name: "Edit", exact: true }).click();
	const edit = page.getByRole("dialog", { name: "Edit expense" });
	await expect(edit).toBeVisible();
	await edit.getByRole("button", { name: "Cancel" }).click();
	await expect(edit).toBeHidden();

	// Delete is the last item of the overflow, with a confirm and an Undo.
	await pane.getByRole("button", { name: /^More actions/ }).click();
	const items = page.getByRole("menu").getByRole("menuitem");
	await expect(items.last()).toContainText("Delete");
	await items.last().click();
	await untilSaved(page, "entry.expense.delete.save", () =>
		page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Delete expense" })
			.click(),
	);
	await expect(pane).toBeHidden();
	const toast = page
		.locator("[data-sonner-toast]")
		.filter({ hasText: "Deleted Monotributo" });
	await expect(toast).toBeVisible();
	await untilSaved(page, "entry.expense.restore.save", () =>
		toast.getByRole("button", { name: "Undo" }).dispatchEvent("click"),
	);
	await expect(main.getByText("Monotributo").first()).toBeVisible();
});

test("Activity at tablet width: with the pane open every amount stays visible", async ({
	page,
}) => {
	await page.setViewportSize({ width: 768, height: 1024 });
	await openV2(page, "/activity?range=all");
	await page.getByRole("main").getByText("Monotributo").first().click();
	const pane = page.getByRole("complementary", { name: "Monotributo" });
	await expect(pane).toBeVisible();
	const row = page.getByRole("main").getByText("Recarga SUBE").first();
	await expect(row).toBeVisible();
	const amount = page.getByRole("main").getByText("$42,000").last();
	await amount.scrollIntoViewIfNeeded();
	await expect(amount).toBeInViewport();
	// The rail shows only the six destinations and More.
	const rail = page.locator("[data-rail]");
	await expect(rail.getByRole("link")).toHaveCount(6);
	await expect(rail.getByRole("button", { name: "More" })).toBeVisible();
});

test("A foreign expense shows the original first, then the home value", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openV2(page, "/activity?range=all");
	await page.getByRole("main").getByText("iCloud 200GB").first().click();
	const pane = page.getByRole("complementary", { name: "iCloud 200GB" });
	await expect(pane).toContainText("USD 2.99");
	await expect(pane).toContainText("$4,335.50");
});
