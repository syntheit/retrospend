import { type Browser, expect, type Page, test } from "@playwright/test";
import { Pool } from "pg";
import { ADMIN_USER, E2E_BASE_URL, E2E_DATABASE_URL } from "../constants";
import { SOFIA } from "../fixtures/personas";
import { loginAs } from "../helpers/auth";
import { bannedOutputOn } from "../helpers/banned-output";
import { gotoReady } from "../helpers/navigation";
import { untilSaved } from "../helpers/trpc";

// The redesigned Currencies page (uiV2). The seed has ARS at 1,450 per USD
// (official) and BRL at 5.4, so 1 USD is ARS 1,450, 1 BRL is ARS 268.52 and
// USD 100 converts to ARS 145,000.
//
// No figure audit yet: rates are not in the figures registry (GAPS,
// "Wealth and Currencies: figure ids").
//
// Favorites go through preferences.toggleFavoriteExchangeRate, which takes
// a cuid; the seed's rate ids are readable strings, so this flow adds one
// EUR rate with a cuid-shaped id (0.9 per USD: 1 EUR is ARS 1,611.11).

/** uiV2 on in this test database, then an admin write refreshes the server's settings cache. */
async function enableUiV2(browser: Browser): Promise<void> {
	const pool = new Pool({ connectionString: E2E_DATABASE_URL });
	try {
		await pool.query(
			`INSERT INTO "app_settings" (id, "updatedAt", "uiV2Mode") VALUES ('app_settings_singleton', now(), 'ALL')
			 ON CONFLICT (id) DO UPDATE SET "uiV2Mode" = 'ALL'`,
		);
		await pool.query(
			`INSERT INTO "exchange_rate" (id, date, currency, type, rate, "createdAt", "updatedAt")
			 VALUES ('cle2e4feur00000000000000', '2025-01-01', 'EUR', 'official', 0.9, now(), now())
			 ON CONFLICT DO NOTHING`,
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

async function openCurrencies(page: Page, query = ""): Promise<void> {
	await loginAs(page, SOFIA.email, SOFIA.password);
	await gotoReady(page, `/currencies${query}`);
	await expect(
		page.locator('[data-ui="v2"][data-page="currencies"]'),
	).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
	await enableUiV2(browser);
});

test("Currencies: prices in ARS, convert, search converter, favorite", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openCurrencies(page);
	const main = page.getByRole("main");

	const table = main.getByRole("table");
	await expect(table.getByRole("row").filter({ hasText: "USD" })).toContainText(
		"1,450",
	);
	// Whole units from ARS 100 up; the server's price keeps its cents.
	const brl = table.getByRole("row").filter({ hasText: "BRL" });
	await expect(brl).toContainText("269");
	await expect(brl.locator("[data-minor='26852']").first()).toBeVisible();

	// The detail panel converts USD 100 on the server, one result per type.
	await table.getByRole("row").filter({ hasText: "USD" }).first().click();
	const detail = main.getByRole("complementary", { name: "Selected currency" });
	await expect(detail).toContainText("ARS 145,000");

	// The search field doubles as a converter.
	await main
		.getByRole("searchbox", { name: "Search, or type 100 usd" })
		.fill("100 usd");
	await expect(
		main.getByRole("heading", { name: /USD 100.*in ARS/ }),
	).toBeVisible();
	await expect(table.getByRole("row").filter({ hasText: "BRL" })).toHaveCount(
		0,
	);
	await main
		.getByRole("searchbox", { name: "Search, or type 100 usd" })
		.fill("");
	expect(await bannedOutputOn(page), "banned output").toEqual([]);

	// Favorite EUR through today's favorites; it sorts first.
	await expect(table.getByRole("row").filter({ hasText: "EUR" })).toContainText(
		"1,611",
	);
	await untilSaved(page, "preferences.toggleFavoriteExchangeRate", () =>
		table.getByRole("button", { name: "Add EUR to favorites" }).click(),
	);
	await expect(
		table.getByRole("button", { name: "Remove EUR from favorites" }),
	).toBeVisible();
	await main.getByRole("button", { name: "Favorites", exact: true }).click();
	await expect(table.getByRole("row").filter({ hasText: "USD" })).toHaveCount(
		0,
	);
	await untilSaved(page, "preferences.toggleFavoriteExchangeRate", () =>
		table.getByRole("button", { name: "Remove EUR from favorites" }).click(),
	);
	await expect(main.getByText("No favorites yet")).toBeVisible();
});

test("Currencies at 390: rows open the rates sheet", async ({ page }) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 390, height: 844 });
	await openCurrencies(page, "?currency=USD");
	const sheet = page.getByRole("dialog", { name: "USD rates" });
	await expect(sheet).toBeVisible();
	await expect(sheet).toContainText("ARS 145,000");
	await page.keyboard.press("Escape");
	const overflow = await page
		.locator('[data-page="currencies"]')
		.evaluate((el) => el.scrollWidth - el.clientWidth);
	expect(overflow).toBeLessThanOrEqual(0);
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
});
