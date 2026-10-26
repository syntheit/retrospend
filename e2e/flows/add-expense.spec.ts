import { expect, test } from "@playwright/test";
import { personaStorageState } from "../constants";
import { SOFIA } from "../fixtures/personas";
import { bannedOutputOn } from "../helpers/banned-output";
import { untilSaved } from "../helpers/trpc";
import { auditSheet, previewFigures, trpcQuery } from "./entry-audit";
import { openV2 } from "./viewer";

// The v2 Add expense sheet (4G) as Sofía: ARS home, the seed's one rate
// (ARS 1,450 Official per USD). Every save here is undone by the toast, so
// the seeded figures other flows read stay as the seed wrote them.

test.use({ storageState: personaStorageState(SOFIA.username) });

type Money = { minor: number; currency: string };
type Catalog = { categories: { id: string; name: string; kind: string }[] };
type Preview = { changes: { id: string; delta: Money; after: Money | null }[] };

const today = () => new Date().toLocaleDateString("en-CA");

test("Add expense: USD at the Official rate, preview, save and Undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openV2(page, "/activity");

	await page.keyboard.press("n");
	const sheet = page.getByRole("dialog", { name: "New expense" });
	await expect(sheet).toBeVisible();

	// USD 12: the home line is the server's booking, 12 x 1,450.
	await sheet.getByRole("button", { name: "Currency, ARS" }).click();
	await page.getByRole("option", { name: /^USD/ }).first().click();
	await sheet.getByRole("textbox", { name: "Amount" }).fill("12");
	await sheet.getByRole("textbox", { name: "Title" }).fill("E2E Streamly");
	await expect(sheet.locator('[data-figure="entry.home"]')).toHaveText(
		"ARS 17,400",
	);
	// The currency chip carries its flag; the home row carries the home one.
	await expect(
		sheet
			.getByRole("button", { name: "Currency, USD" })
			.locator('img[alt="USD flag"]'),
	).toBeVisible();
	await expect(sheet.locator('img[alt="ARS flag"]')).toBeVisible();
	// Every rate type the pair offers sits beside the amount, the default pressed.
	const rates = sheet.getByRole("group", { name: "Rate" });
	await expect(
		rates.getByRole("button", { name: /Official ARS 1,450/ }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(rates.getByRole("button", { name: "Custom" })).toBeVisible();
	// The recents line fits the width; All reaches every category.
	await sheet
		.getByRole("group", { name: "Category" })
		.getByRole("button", { name: "All" })
		.click();
	await page.getByRole("option", { name: "Subscriptions" }).click();

	// What this changes: spending moves in USD; accounts and net worth do not.
	const changes = sheet.getByTestId("entry-changes");
	await expect(changes).toContainText("Your spending");
	await expect(changes).toContainText("+USD 12.00");
	await expect(changes).toContainText("your accounts, net worth");
	expect(await bannedOutputOn(page), "banned output").toEqual([]);

	// The audit: the sheet's figures against the same server reads.
	const catalog = await trpcQuery<Catalog>(page, "entry.catalog");
	const subs = catalog.categories.find((c) => c.name === "Subscriptions");
	const preview = await trpcQuery<Preview>(
		page,
		"entry.expense.create.preview",
		{
			id: "e2e-audit",
			title: "E2E Streamly",
			amount: "12",
			currency: "USD",
			date: today(),
			categoryId: subs?.id,
		},
	);
	expect(
		await auditSheet(page, "addExpense", {
			"entry.home": { minor: 1_740_000, currency: "ARS" },
			...previewFigures(preview),
		}),
	).toEqual([]);

	// A double click saves once.
	await untilSaved(page, "entry.expense.create.save", () =>
		sheet.getByRole("button", { name: "Add expense" }).dblclick(),
	);
	await expect(sheet).toBeHidden();
	const main = page.getByRole("main");
	await expect(main.getByText("E2E Streamly")).toHaveCount(1);
	await untilSaved(page, "entry.expense.delete.save", () =>
		page
			.locator("[data-sonner-toast]")
			.filter({ hasText: "Added E2E Streamly" })
			.getByRole("button", { name: "Undo" })
			.click(),
	);
	await expect(main.getByText("E2E Streamly")).toHaveCount(0);
});

test("Add expense: split evenly with Martín, then Undo", async ({ page }) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openV2(page, "/activity");

	await page.keyboard.press("n");
	const sheet = page.getByRole("dialog", { name: "New expense" });
	await sheet.getByRole("textbox", { name: "Amount" }).fill("6000");
	await sheet.getByRole("textbox", { name: "Title" }).fill("E2E dinner");
	await sheet
		.getByRole("group", { name: "Category" })
		.getByRole("button", { name: "All" })
		.click();
	await page.getByRole("option", { name: "Restaurants" }).click();
	await sheet
		.getByRole("group", { name: "With" })
		.getByRole("button", { name: /Martín/ })
		.click();

	// One row per person with a face and the share resolveSplits gives.
	await expect(
		sheet.locator('[data-split-row="user:e2e_user_sofia"]'),
	).toContainText("ARS 3,000");
	await expect(
		sheet.locator('[data-split-row="user:e2e_user_martin"]'),
	).toContainText("ARS 3,000");
	await expect(
		sheet.getByRole("radio", { name: "Martín owes all" }),
	).toBeVisible();
	await expect(sheet.getByTestId("entry-changes")).toContainText("+ARS 3,000");

	await untilSaved(page, "entry.shared.create.save", () =>
		sheet.getByRole("button", { name: "Add expense" }).click(),
	);
	await expect(sheet).toBeHidden();
	await untilSaved(page, "entry.shared.delete.save", () =>
		page
			.locator("[data-sonner-toast]")
			.filter({ hasText: "Added E2E dinner" })
			.getByRole("button", { name: "Undo" })
			.click(),
	);
	await expect(page.getByRole("main").getByText("E2E dinner")).toHaveCount(0);
});

test("Add expense: errors before saving, and nothing is saved", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openV2(page, "/activity");
	await page.keyboard.press("n");
	const sheet = page.getByRole("dialog", { name: "New expense" });
	await sheet.getByRole("button", { name: "Add expense" }).click();
	await expect(sheet.getByText("Enter an amount above zero")).toBeVisible();
	await expect(
		sheet.getByText("Pick a category", { exact: true }),
	).toBeVisible();
	await sheet.getByRole("button", { name: "Cancel" }).click();
	await expect(sheet).toBeHidden();
});

test("Add expense: the project picker shows each project with its people", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openV2(page, "/activity");
	await page.keyboard.press("n");
	const sheet = page.getByRole("dialog", { name: "New expense" });
	await sheet.getByRole("button", { name: "Project, None" }).click();
	const depto = page.getByRole("option", { name: /Depto Palermo/ });
	// The server's head count (you and Martín) and the project's currency.
	await expect(depto).toContainText("2 people · ARS");
	await depto.click();
	// The project brings its currency and its people into the sheet.
	await expect(
		sheet.getByRole("button", { name: "Project, Depto Palermo" }),
	).toBeVisible();
	await expect(
		sheet.getByRole("button", { name: "Currency, ARS" }),
	).toBeVisible();
	await expect(
		sheet
			.getByRole("group", { name: "With" })
			.getByRole("button", { name: /Martín/ }),
	).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await sheet.getByRole("button", { name: "Cancel" }).click();
});
