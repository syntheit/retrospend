import { expect, test } from "@playwright/test";
import { personaStorageState } from "../../constants";
import { SOFIA } from "../../fixtures/personas";
import { bannedOutputOn } from "../../helpers/banned-output";
import { untilSaved } from "../../helpers/trpc";
import { trpcMutation } from "./entry-audit";
import { openV2 } from "./viewer";

// Transfer and Exchange (T) as Sofía, between two accounts this flow opens
// and deletes, so her seeded balances stay as the seed wrote them.
// Buy USD 300 for ARS 442,500: the rate comes from the two typed amounts,
// 442,500 / 300 = 1,475 per USD; against Official (1,450) that is
// 300 x 25 = ARS 7,500 more, an exchange result in net worth, not spending.

test.use({ storageState: personaStorageState(SOFIA.username) });

type Account = { id: string };

test("Exchange: both amounts typed, rate derived, preview, save and Undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openV2(page, "/activity");
	const open = (name: string, currency: string, balance: number) =>
		trpcMutation<Account>(page, "wealth.createAsset", {
			name,
			type: "CASH",
			currency,
			balance,
			isLiquid: true,
		});
	const pesos = await open("E2E pesos", "ARS", 1_000_000);
	const dollars = await open("E2E dollars", "USD", 0);
	// The new accounts come with the catalog the sheet reads on open.
	await openV2(page, "/activity");

	try {
		await page.keyboard.press("t");
		const sheet = page.getByRole("dialog");
		await expect(sheet).toBeVisible();
		await sheet.getByRole("combobox", { name: "From" }).click();
		await page.getByRole("option", { name: /^E2E pesos/ }).click();
		await sheet.getByRole("combobox", { name: "To" }).click();
		await page.getByRole("option", { name: /^E2E dollars/ }).click();
		await expect(page.getByRole("dialog", { name: "Exchange" })).toBeVisible();

		const amounts = sheet.getByRole("textbox", { name: "Amount" });
		await amounts.nth(0).fill("442500");
		await amounts.nth(1).fill("300");
		await expect(sheet.getByTestId("transfer-rate")).toHaveText(
			"USD 1 = ARS 1,475 · Official ARS 1,450 · ARS 7,500 more",
		);
		const changes = sheet.getByTestId("entry-changes");
		await expect(changes).toContainText("E2E pesos");
		await expect(changes).toContainText("ARS 557,500");
		await expect(changes).toContainText("USD 300.00");
		await expect(changes).toContainText("-ARS 7,500");
		expect(await bannedOutputOn(page), "banned output").toEqual([]);

		await untilSaved(page, "entry.transfer.save", () =>
			sheet.getByRole("button", { name: "Buy USD" }).click(),
		);
		await expect(sheet).toBeHidden();
		await untilSaved(page, "wealth.transfers.delete.save", () =>
			page
				.locator("[data-sonner-toast]")
				.filter({ hasText: "Bought USD 300.00" })
				.getByRole("button", { name: "Undo" })
				.click(),
		);
	} finally {
		for (const a of [pesos, dollars])
			await trpcMutation(page, "wealth.deleteAssetPermanently", { id: a.id });
	}
});
