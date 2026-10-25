import { expect, test } from "@playwright/test";
import { personaStorageState } from "../constants";
import { SOFIA } from "../fixtures/personas";
import { bannedOutputOn } from "../helpers/banned-output";
import { openV2 } from "./viewer";

// Someone else's shared expense opens as a read view (owner Q1, RC11):
// Lucía added "Cena en La Esquina", so Sofía sees it, her share and its
// state, and Ask Lucía to fix (the sheets are in corrections.spec.ts). Her
// own expense opens in the edit sheet.

test.use({ storageState: personaStorageState(SOFIA.username) });

test("Entry: read view of someone else's expense, edit sheet for your own", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openV2(page, "/activity?range=all");
	const main = page.getByRole("main");

	// The row's menu offers Ask to fix (the corrections router allows it) and opens
	// that sheet; Cancel goes back to the read view.
	await main.getByText("Cena en La Esquina").first().click({ button: "right" });
	await page.getByRole("menuitem", { name: "Ask to fix" }).click();
	const ask = page.getByRole("dialog", { name: "Ask Lucía to fix it" });
	await expect(ask).toBeVisible();
	await ask.getByRole("button", { name: "Cancel" }).click();
	const read = page.getByRole("dialog", { name: "Cena en La Esquina" });
	await expect(read).toBeVisible();
	await expect(
		read.getByText("Lucía added this. Only Lucía can edit it"),
	).toBeVisible();
	await expect(read).toContainText("ARS 64,000");
	await expect(read).toContainText("ARS 32,000");
	await expect(
		read.getByRole("button", { name: "Ask Lucía to fix" }),
	).toBeEnabled();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await read.getByRole("button", { name: "Close" }).last().click();
	await expect(read).toBeHidden();

	// Her own personal expense opens the edit sheet, loaded and formatted.
	await main.getByText("Monotributo").first().click();
	const edit = page.getByRole("dialog", { name: "Edit expense" });
	await expect(edit).toBeVisible();
	await expect(edit.getByRole("textbox", { name: "Amount" })).toHaveValue(
		"42,000",
	);
	await expect(
		edit.getByRole("button", { name: "Undo changes" }),
	).toBeDisabled();
	await edit.getByRole("button", { name: "Cancel" }).click();
	await expect(edit).toBeHidden();
});
