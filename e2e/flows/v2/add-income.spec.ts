import { expect, test } from "@playwright/test";
import { personaStorageState } from "../../constants";
import { SOFIA } from "../../fixtures/personas";
import { bannedOutputOn } from "../../helpers/banned-output";
import { untilSaved } from "../../helpers/trpc";
import { openV2 } from "./viewer";

// Add income (owner N71: its own sheet, I) as Sofía. No account picked:
// accounts and net worth do not change (N75). She has no envelope budget,
// so Use my plan is not preselected and the money stays Not planned yet.
// The toast's Undo takes the income back.

test.use({ storageState: personaStorageState(SOFIA.username) });

test("Add income: no account, no plan without a budget, save and Undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openV2(page, "/activity");

	await page.keyboard.press("i");
	const sheet = page.getByRole("dialog", { name: "Add income" });
	await expect(sheet).toBeVisible();
	await sheet.getByRole("button", { name: "Add income" }).click();
	await expect(sheet.getByText("Who paid you?")).toBeVisible();
	await expect(sheet.getByText("Pick what it is")).toBeVisible();

	await sheet.getByRole("textbox", { name: "Amount" }).fill("850000");
	await sheet.getByRole("button", { name: "Someone else" }).click();
	await sheet.getByRole("textbox", { name: "Who paid you" }).fill("E2E Andino");
	await sheet.getByRole("button", { name: "Salary", exact: true }).click();
	await expect(
		sheet.getByText("No account: it goes to your budget as Not planned yet."),
	).toBeVisible();
	// No envelope budget: Use my plan is not preselected.
	await expect(
		sheet.getByRole("radio", { name: "Keep as Not planned yet" }),
	).toBeChecked();
	await expect(sheet.getByTestId("entry-plan")).toHaveCount(0);
	// Nothing moves here, so no "Nothing else changes" line.
	await expect(sheet.getByTestId("entry-changes")).toContainText(
		"No change to your accounts",
	);
	expect(await bannedOutputOn(page), "banned output").toEqual([]);

	await untilSaved(page, "wealth.income.add.save", () =>
		sheet.getByRole("button", { name: "Add income" }).click(),
	);
	await expect(sheet).toBeHidden();
	await untilSaved(page, "wealth.income.delete.save", () =>
		page
			.locator("[data-sonner-toast]")
			.filter({ hasText: "Added ARS 850,000" })
			.getByRole("button", { name: "Undo" })
			.click(),
	);
});

test("Add income: a pair with no rate asks for one, never 1", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openV2(page, "/activity");
	await page.keyboard.press("i");
	const sheet = page.getByRole("dialog", { name: "Add income" });
	// UYU has no rate in the seed: the home row needs one, and Enter rate opens it.
	await sheet.getByRole("button", { name: "Currency, ARS" }).click();
	await page.keyboard.type("UYU");
	// The list filters as you type; click once it has settled on the one match,
	// not on an option the next keystroke is about to move.
	const uyu = page.getByRole("option");
	await expect(uyu).toHaveCount(1);
	await uyu.click();
	// The picker closes on the choice; type the amount once the currency shows.
	await expect(
		sheet.getByRole("button", { name: "Currency, UYU" }),
	).toBeVisible();
	await sheet.getByRole("textbox", { name: "Amount" }).fill("1000");
	await expect(sheet.getByText("Needs a rate")).toBeVisible();
	await sheet.getByRole("button", { name: "Enter rate" }).click();
	// 1 UYU = 40 ARS: UYU 1,000 counts as ARS 40,000, booked by the server.
	await sheet.getByRole("textbox", { name: "Custom rate in ARS" }).fill("40");
	await expect(sheet.locator('[data-figure="entry.income.home"]')).toHaveText(
		"ARS 40,000",
	);
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await sheet.getByRole("button", { name: "Cancel" }).click();
});
