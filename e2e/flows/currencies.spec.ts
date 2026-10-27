import { expect, type Page, test } from "@playwright/test";
import { Pool } from "pg";
import { E2E_DATABASE_URL, personaStorageState } from "../constants";
import { SOFIA } from "../fixtures/personas";
import { bannedOutputOn } from "../helpers/banned-output";
import { gotoReady } from "../helpers/navigation";
import { untilSaved } from "../helpers/trpc";

// The Currencies page, in Sofía's saved session (ARS home). The seed has
// ARS at 1,450 per USD (official) and BRL at 5.4, so each row reads what
// 1 ARS buys: USD 0.00069 (1 / 1450), BRL 0.0037 (5.4 / 1450). Converting
// 100 ARS gives USD 0.07; swapped, USD 100 converts to ARS 145,000.
//
// No figure audit yet: rates are not in the figures registry (GAPS,
// "Wealth and Currencies: figure ids").
//
// The favorite step needs a currency the seed has no rate for, so this flow
// adds one EUR rate with a cuid-shaped id (0.9 per USD: 1 ARS buys
// EUR 0.00062).

/** The EUR rate the favorite step needs. */
async function addEurRate(): Promise<void> {
	const pool = new Pool({ connectionString: E2E_DATABASE_URL });
	try {
		await pool.query(
			`INSERT INTO "exchange_rate" (id, date, currency, type, rate, "createdAt", "updatedAt")
			 VALUES ('cle2e4feur00000000000000', '2025-01-01', 'EUR', 'official', 0.9, now(), now())
			 ON CONFLICT DO NOTHING`,
		);
	} finally {
		await pool.end();
	}
}

test.use({ storageState: personaStorageState(SOFIA.username) });

async function openCurrencies(page: Page, query = ""): Promise<void> {
	await gotoReady(page, `/currencies${query}`);
	await expect(
		page.locator('[data-ui="v2"][data-page="currencies"]'),
	).toBeVisible();
}

test.beforeAll(async () => {
	await addEurRate();
});

test("Currencies: 1 ARS in each currency, convert, search converter, favorite", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openCurrencies(page);
	const main = page.getByRole("main");

	await expect(main).toContainText("Price of 1 ARS.");
	const table = main.getByRole("table");
	// Each row is what 1 home unit buys in that currency, with its own code.
	const usd = table.getByRole("row").filter({ hasText: "USD" });
	await expect(usd).toContainText("USD 0.00069");
	await expect(usd.locator("[data-minor='69']").first()).toHaveAttribute(
		"data-currency",
		"USD",
	);
	const brl = table.getByRole("row").filter({ hasText: "BRL" });
	await expect(brl).toContainText("BRL 0.0037");
	await expect(brl.locator("[data-minor='37']").first()).toBeVisible();

	// The detail panel reads the same direction and converts on the server.
	await usd.first().click();
	const detail = main.getByRole("complementary", { name: "Selected currency" });
	await expect(detail).toContainText("1 ARS in USD");
	await expect(detail).toContainText("USD 0.00069");
	// Home to foreign by default: ARS 100 into USD (100 / 1,450 = 0.069).
	await expect(detail.getByRole("textbox", { name: "Amount" })).toHaveValue(
		"100",
	);
	await expect(detail).toContainText("USD 0.07");
	await detail.getByRole("button", { name: "Swap direction" }).click();
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
		"EUR 0.00062",
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
	await expect(sheet).toContainText("1 ARS in USD");
	await expect(sheet).toContainText("USD 0.07");
	await sheet.getByRole("button", { name: "Swap direction" }).click();
	await expect(sheet).toContainText("ARS 145,000");
	await page.keyboard.press("Escape");
	const overflow = await page
		.locator('[data-page="currencies"]')
		.evaluate((el) => el.scrollWidth - el.clientWidth);
	expect(overflow).toBeLessThanOrEqual(0);
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
});
