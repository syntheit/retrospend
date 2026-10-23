import { expect, type Page, test } from "@playwright/test";
import { LUCIA, MARTIN, PAZ, SOFIA } from "../fixtures/personas";
import { loginAs } from "../helpers/auth";
import { bannedOutputOn } from "../helpers/banned-output";
import { gotoReady } from "../helpers/navigation";
import { untilSaved } from "../helpers/trpc";
import { enablePeopleV2 } from "./people-flags";

// Settle up (uiV2) from the Person page: the preview says what Record will
// change before Save (R30), Record ends with an Undo toast (R15), more than
// owed asks first, and money received that matches a pending claim asks
// "Same payment?". The amounts themselves are recomputed by hand in
// src/server/services/people/people.pg.test.ts.

test.beforeAll(async ({ browser }) => {
	await enablePeopleV2(browser);
});

async function openSettle(page: Page, path: string, name: string) {
	await gotoReady(page, path);
	await page
		.getByRole("main")
		.getByRole("button", { name: "Settle up" })
		.first()
		.click();
	const sheet = page.getByRole("dialog", { name: `Settle up with ${name}` });
	await expect(sheet).toBeVisible();
	return sheet;
}

test("Settle up: Everything with Martín, preview, record, undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await loginAs(page, SOFIA.email, SOFIA.password);
	const sheet = await openSettle(page, `/people/user/${MARTIN.id}`, "Martín");

	const record = sheet.getByRole("button", { name: /^Record/ });
	await expect(record).toBeDisabled();
	await sheet.getByRole("button", { name: /^Everything/ }).click();
	await expect(sheet.getByRole("region", { name: "This pays" })).toBeVisible();
	const changes = sheet.getByRole("region", { name: "What this changes" });
	await expect(changes).toBeVisible();
	await expect(
		changes.getByText(/Your balance with Martín/).first(),
	).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);

	await expect(record).toBeEnabled();
	await untilSaved(page, "settlement.paymentRecord", () => record.click());
	await expect(sheet.getByText("Payment recorded")).toBeVisible();
	await expect(
		sheet.getByRole("region", { name: "What changed" }),
	).toBeVisible();
	const toast = page
		.locator("[data-sonner-toast]")
		.filter({ hasText: "Martín" });
	await untilSaved(page, "people.undoPayment", () =>
		toast.getByRole("button", { name: "Undo" }).click(),
	);
	await sheet.getByRole("button", { name: "Done" }).first().click();
	await expect(sheet).toBeHidden();
	await expect(
		page.locator("[data-sonner-toast]").filter({ hasText: "Undone" }),
	).toBeVisible();
});

test("Settle up: more than Paz owes asks first", async ({ page }) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await loginAs(page, SOFIA.email, SOFIA.password);
	const sheet = await openSettle(page, `/people/shadow/${PAZ.id}`, "Paz");
	await sheet.getByRole("radio", { name: "Paz paid me" }).click();
	await sheet.getByRole("textbox", { name: "Amount" }).fill("99999999");
	const alert = sheet
		.getByRole("alert")
		.filter({ hasText: "more than Paz owes you" });
	await expect(alert).toBeVisible();
	const record = sheet.locator("[data-sheet-submit]");
	await expect(record).toBeDisabled();
	await alert.getByRole("button", { name: "Record it anyway" }).click();
	await expect(record).toBeEnabled();
	await sheet.getByRole("button", { name: "Cancel" }).click();
	await expect(sheet).toBeHidden();
});

test("Settle up: ARS 20,000 from Lucía matches her claim", async ({ page }) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await loginAs(page, SOFIA.email, SOFIA.password);
	const sheet = await openSettle(page, `/people/user/${LUCIA.id}`, "Lucía");
	await sheet.getByRole("radio", { name: "Lucía paid me" }).click();
	await sheet.getByRole("textbox", { name: "Amount" }).fill("20000");
	await expect(sheet.getByText("Same payment?").first()).toBeVisible();
	await expect(sheet.getByText(/Nothing counts twice/)).toBeVisible();
	await expect(sheet.getByRole("button", { name: /^Record/ })).toBeEnabled();
});
