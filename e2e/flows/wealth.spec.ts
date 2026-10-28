import { expect, type Page, test } from "@playwright/test";
import { personaStorageState } from "../constants";
import { SOFIA } from "../fixtures/personas";
import { bannedOutputOn } from "../helpers/banned-output";
import { gotoReady } from "../helpers/navigation";
import { untilSaved } from "../helpers/trpc";

// The Wealth page on Sofía's seeded accounts, in her saved
// session. The flows project.
//
// No figure audit yet: the figures registry has no netWorth or account
// figures until track 2D registers them, so the page tags none and the audit
// would only report them missing (docs/ui/GAPS.md, "Wealth and Currencies:
// figure ids"). 2D registered netWorth; add `audit.checkPage(page,
// "wealth")` once the page tags it.
//
// The write steps run on an account this flow adds through the page, so
// the seeded balances other flows read stay as the seed wrote them.

test.use({ storageState: personaStorageState(SOFIA.username) });

async function openWealth(page: Page): Promise<void> {
	await gotoReady(page, "/wealth");
	await expect(
		page.locator('[data-ui="v2"][data-page="wealth"]'),
	).toBeVisible();
}

test("Wealth: net worth, the accounts by group, update a balance and undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openWealth(page);
	const main = page.getByRole("main");

	await expect(main.getByRole("heading", { name: "Wealth" })).toBeVisible();
	await expect(main.getByText("Net worth", { exact: true })).toBeVisible();
	await expect(
		main.getByRole("heading", { name: "Cash and bank" }),
	).toBeVisible();
	await expect(
		main.getByRole("heading", { name: "Liabilities" }),
	).toBeVisible();
	// A foreign account shows its own amount first, the home value under it.
	const wise = main.getByRole("listitem").filter({ hasText: "Wise (USD)" });
	await expect(wise).toContainText("USD 2,350");
	await expect(wise).toContainText("$3,407,500");
	expect(await bannedOutputOn(page), "banned output").toEqual([]);

	// Add an account, update its balance and undo, close it, delete it.
	await main.getByRole("button", { name: "Add account" }).click();
	const add = page.getByRole("dialog", { name: "Add account" });
	await add.getByRole("textbox", { name: "Name" }).fill("E2E savings");
	await add.getByRole("button", { name: "Currency, ARS" }).click();
	await page.getByRole("option", { name: /^USD/ }).first().click();
	await add.getByRole("textbox", { name: "Amount" }).fill("1000");
	await untilSaved(page, "wealth.createAsset", () =>
		add.getByRole("button", { name: "Add account" }).click(),
	);
	const row = main.getByRole("listitem").filter({ hasText: "E2E savings" });
	await expect(row).toContainText("USD 1,000");
	await expect(row).toContainText("$1,450,000");

	// The row opens Update balance; the save shows an Undo.
	await main.getByRole("button", { name: "E2E savings", exact: true }).click();
	const sheet = page.getByRole("dialog", { name: "Update balance" });
	await sheet.getByRole("textbox", { name: "Amount" }).fill("1200");
	await untilSaved(page, "wealth.updateAssetBalance", () =>
		sheet.getByRole("button", { name: "Update balance" }).click(),
	);
	await expect(sheet).toBeHidden();
	await expect(row).toContainText("USD 1,200");
	await untilSaved(page, "wealth.updateAssetBalance", () =>
		page
			.locator("[data-sonner-toast]")
			.filter({ hasText: "E2E savings updated" })
			.getByRole("button", { name: "Undo" })
			.click(),
	);
	await expect(row).toContainText("USD 1,000");

	// Close (keeps history), then delete permanently from Closed accounts.
	await row
		.getByRole("button", { name: "More actions for E2E savings" })
		.click();
	await page.getByRole("menuitem", { name: "Close account" }).click();
	const close = page.getByRole("dialog", { name: "Close E2E savings?" });
	await untilSaved(page, "wealth.closeAsset", () =>
		close.getByRole("button", { name: "Close account" }).click(),
	);
	await main.getByRole("button", { name: /Closed accounts/ }).click();
	const closed = main.getByRole("listitem").filter({ hasText: "E2E savings" });
	await closed
		.getByRole("button", { name: "More actions for E2E savings" })
		.click();
	await page.getByRole("menuitem", { name: "Delete permanently" }).click();
	await untilSaved(page, "wealth.deleteAssetPermanently", () =>
		page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Delete permanently" })
			.click(),
	);
	await expect(main.getByText("E2E savings")).toHaveCount(0);
});

test("Wealth: filters narrow the list only, breakdown view", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openWealth(page);
	const main = page.getByRole("main");

	await main.getByRole("button", { name: "Foreign currency" }).click();
	await expect(main.getByText("Galicia (ARS)")).toBeHidden();
	await expect(main.getByText("Cash (USD)")).toBeVisible();
	await main.getByRole("button", { name: "Foreign currency" }).click();

	await main.getByRole("radio", { name: "Breakdown" }).click();
	await expect(
		main.getByRole("heading", { name: "By currency" }),
	).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
});

test("Wealth at 390: no sideways scroll, Add account in the header", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 390, height: 844 });
	await openWealth(page);
	await expect(page.getByRole("button", { name: "Add account" })).toBeVisible();
	const overflow = await page
		.locator('[data-page="wealth"]')
		.evaluate((el) => el.scrollWidth - el.clientWidth);
	expect(overflow).toBeLessThanOrEqual(0);
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
});
