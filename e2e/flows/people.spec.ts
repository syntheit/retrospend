import { expect, test } from "@playwright/test";
import { SOFIA } from "../fixtures/personas";
import { loginAs } from "../helpers/auth";
import { bannedOutputOn } from "../helpers/banned-output";
import { FigureAudit, httpFigureFetcher } from "../helpers/figures";
import { gotoReady } from "../helpers/navigation";
import { untilSaved } from "../helpers/trpc";
import { enablePeopleV2 } from "./people-flags";

// The redesigned People page (uiV2) on Sofía's seeded ledger: Owed to you
// and You owe as two figures (D1) that match the figures API, the groups,
// search, and Needs you (Lucía says she paid ARS 20,000 in cash): Confirm,
// then Undo puts it back.

test.beforeAll(async ({ browser }) => {
	await enablePeopleV2(browser);
});

test("People: standing, groups, search, confirm a payment and undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await loginAs(page, SOFIA.email, SOFIA.password);
	await gotoReady(page, "/people");
	await expect(
		page.locator('[data-ui="v2"][data-page="people"]'),
	).toBeVisible();
	const main = page.getByRole("main");

	await expect(
		main.getByRole("heading", { name: "People", level: 1 }),
	).toBeVisible();
	const standing = main.getByRole("region", { name: "Where you stand" });
	await expect(
		standing.getByText("Owed to you", { exact: true }),
	).toBeVisible();
	await expect(standing.getByText("You owe", { exact: true })).toBeVisible();
	await expect(main.getByRole("heading", { name: /^Owe you/ })).toBeVisible();
	for (const name of ["Lucía Fernández", "Martín Acosta", "Paz Ibarra"])
		await expect(main.getByRole("link", { name })).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	const audit = new FigureAudit(httpFigureFetcher(page.request));
	expect(await audit.checkPage(page, "people", "people")).toEqual([]);

	// Search folds accents; Clear filters brings everyone back.
	const search = main.getByRole("searchbox", { name: "Search people" });
	await search.fill("lucia");
	await expect(main.getByRole("link", { name: "Martín Acosta" })).toHaveCount(
		0,
	);
	await expect(
		main.getByRole("link", { name: "Lucía Fernández" }),
	).toBeVisible();
	await search.fill("zzz");
	await main.getByRole("button", { name: "Clear filters" }).click();
	await expect(main.getByRole("link", { name: "Martín Acosta" })).toBeVisible();

	// Needs you: confirm Lucía's cash payment, then undo it.
	const needs = main.getByRole("region", { name: /Needs you/ });
	const item = needs
		.getByRole("listitem")
		.filter({ hasText: "Lucía says they paid you" });
	await expect(item).toBeVisible();
	await untilSaved(page, "settlement.paymentConfirm", () =>
		item.getByRole("button", { name: "Confirm" }).click(),
	);
	const toast = page
		.locator("[data-sonner-toast]")
		.filter({ hasText: "Confirmed Lucía's payment" });
	await expect(toast).toBeVisible();
	await untilSaved(page, "settlement.paymentUnconfirm", () =>
		toast.getByRole("button", { name: "Undo" }).click(),
	);
	await expect(item).toBeVisible();
});
