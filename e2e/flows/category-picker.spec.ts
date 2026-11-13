import { personaStorageState } from "../constants";
import { SOFIA } from "../fixtures/personas";
import { expect, test } from "../fixtures/sealed-guard";
import { openV2 } from "./viewer";

// The one CategoryPicker by keyboard: it filters as you type, Enter picks the
// top match, arrows move, Escape closes only the picker. Nothing is saved.

test.use({ storageState: personaStorageState(SOFIA.username) });

test("Category picker in the expense sheet: type, arrows, Enter, Escape", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openV2(page, "/activity");
	await page.keyboard.press("n");
	const sheet = page.getByRole("dialog", { name: "New expense" });
	await expect(sheet).toBeVisible();
	const all = sheet
		.getByRole("group", { name: "Category" })
		.getByRole("button", { name: "All categories" });

	// Arrows move the highlight; Escape closes the picker, not the sheet.
	await all.click();
	const find = page.getByRole("combobox", { name: "Category" });
	await expect(find).toBeFocused();
	const options = page.getByRole("option");
	await expect(options.first()).toHaveAttribute("aria-selected", "true");
	await page.keyboard.press("ArrowDown");
	await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
	await expect(options.first()).toHaveAttribute("aria-selected", "false");
	await page.keyboard.press("Escape");
	await expect(find).toBeHidden();
	await expect(sheet).toBeVisible();

	// Typing narrows the list (case and accents ignored); Enter picks the top match.
	await all.click();
	const total = await options.count();
	await page.keyboard.type("SUBS");
	await expect(options).toHaveCount(1);
	expect(total).toBeGreaterThan(1);
	await expect(options.first()).toContainText("Subscriptions");
	await page.keyboard.press("Enter");
	await expect(find).toBeHidden();
	await expect(
		sheet
			.getByRole("group", { name: "Category" })
			.getByRole("button", { name: "Subscriptions" }),
	).toHaveAttribute("aria-pressed", "true");

	// No match says so and Enter picks nothing.
	await all.click();
	await page.keyboard.type("zzzz");
	await expect(page.getByText("No matches")).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(find).toBeVisible();
});

test("Category filter: a pick toggles and the list stays open, Clear empties it", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openV2(page, "/activity");
	const main = page.getByRole("main");
	const chip = main.getByRole("button", { name: /^(Category|Subscriptions)/ });
	await chip.click();
	const find = page.getByRole("combobox", { name: "Category" });
	await expect(find).toBeFocused();

	await page.keyboard.type("subs");
	await page.keyboard.press("Enter");
	// Still open, the chip names the pick, the option is marked.
	await expect(find).toBeVisible();
	await expect(chip).toHaveText("Subscriptions");
	await expect(
		page.getByRole("option", { name: /Subscriptions/ }),
	).toHaveAttribute("data-chosen", "true");

	// Enter again takes it back off.
	await page.keyboard.press("Enter");
	await expect(chip).toHaveText("Category");

	await page.keyboard.press("Enter");
	await expect(chip).toHaveText("Subscriptions");
	await page.getByRole("button", { name: "Clear", exact: true }).click();
	await expect(chip).toHaveText("Category");
	await page.keyboard.press("Escape");
	await expect(find).toBeHidden();
});
