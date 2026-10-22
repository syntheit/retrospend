import { type Browser, expect, type Page, test } from "@playwright/test";
import { Pool } from "pg";
import { ADMIN_USER, E2E_BASE_URL, E2E_DATABASE_URL } from "../constants";
import { SOFIA } from "../fixtures/personas";
import { loginAs } from "../helpers/auth";
import { bannedOutputOn } from "../helpers/banned-output";
import { gotoReady } from "../helpers/navigation";
import { untilSaved } from "../helpers/trpc";

// The redesigned Wealth page (uiV2) on Sofía's seeded accounts.
//
// No figure audit yet: the figures registry has no netWorth or account
// figures until track 2D registers them, so the page tags none and the audit
// would only report them missing (docs/ui/GAPS.md, "Wealth and Currencies:
// figure ids"). Add `audit.checkPage(page, "wealth")` when 2D lands.
//
// The wealth mutations take cuid ids and the seed's account ids are
// readable strings, so the write steps run on an account this flow adds
// through the page (the server gives it a cuid).

/**
 * uiV2 on for everyone in this test database, then any admin settings
 * write, which re-reads the row into the server's 60-second cache.
 */
async function enableUiV2(browser: Browser): Promise<void> {
	const pool = new Pool({ connectionString: E2E_DATABASE_URL });
	try {
		await pool.query(
			`INSERT INTO "app_settings" (id, "updatedAt", "uiV2Mode") VALUES ('app_settings_singleton', now(), 'ALL')
			 ON CONFLICT (id) DO UPDATE SET "uiV2Mode" = 'ALL'`,
		);
	} finally {
		await pool.end();
	}
	const context = await browser.newContext({ baseURL: E2E_BASE_URL });
	const origin = { Origin: E2E_BASE_URL };
	const signIn = await context.request.post("/api/auth/sign-in/email", {
		data: { email: ADMIN_USER.email, password: ADMIN_USER.password },
		headers: origin,
	});
	expect(signIn.ok(), "admin sign-in").toBe(true);
	const refresh = await context.request.post(
		"/api/trpc/admin.updateSettings?batch=1",
		{ data: { 0: { json: {} } }, headers: origin },
	);
	expect(refresh.ok(), "settings cache refresh").toBe(true);
	await context.close();
}

async function openWealth(page: Page): Promise<void> {
	await loginAs(page, SOFIA.email, SOFIA.password);
	await gotoReady(page, "/wealth");
	await expect(
		page.locator('[data-ui="v2"][data-page="wealth"]'),
	).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
	await enableUiV2(browser);
});

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
	await expect(wise).toContainText("ARS 3,407,500");
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
	await expect(row).toContainText("ARS 1,450,000");

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
