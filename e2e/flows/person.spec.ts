import { expect, test } from "@playwright/test";
import { personaStorageState } from "../constants";
import { PAZ, SOFIA } from "../fixtures/personas";
import { bannedOutputOn } from "../helpers/banned-output";
import { gotoReady } from "../helpers/navigation";

// The Person page for Paz, who is not on Retrospend: the
// balance with its currency parts, the projects with her, and Between you
// with its chips and project scope.
//
// No figure audit: the page's numbers are per person (balance.person needs
// a personId narrowing), which a data-figure id cannot carry yet
// (docs/ui/GAPS.md, "People: per-person figure ids").

// Sofía's saved session; the flows project saved it (auth.setup.ts).
test.use({ storageState: personaStorageState(SOFIA.username) });

test("Person: balance, projects, Between you filters", async ({ page }) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await gotoReady(page, "/people");
	await page.getByRole("main").getByRole("link", { name: PAZ.name }).click();
	await expect(page).toHaveURL(new RegExp(`/people/shadow/${PAZ.id}$`));
	await expect(
		page.locator('[data-ui="v2"][data-page="person"]'),
	).toBeVisible();
	const main = page.getByRole("main");

	await expect(
		main.getByRole("heading", { name: PAZ.name, level: 1 }),
	).toBeVisible();
	await expect(main.getByText("Not on Retrospend").first()).toBeVisible();
	await expect(main.getByText("Paz owes you")).toBeVisible();
	await expect(
		main.getByRole("button", { name: "Settle up" }).first(),
	).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);

	const ledger = main.getByRole("region", { name: "Between you" });
	await expect(ledger.getByText("Pasajes a Florianópolis")).toBeVisible();
	await expect(ledger.getByText("Seguro de viaje")).toBeVisible();

	// "Paid by Paz" keeps what she paid.
	await ledger.getByRole("button", { name: "Paid by Paz" }).click();
	await expect(ledger.getByText("Pasajes a Florianópolis")).toHaveCount(0);
	await expect(ledger.getByText("Seguro de viaje")).toBeVisible();
	await ledger.getByRole("button", { name: "Paid by Paz" }).click();

	// A project row scopes the list to that project.
	await main.getByRole("button", { name: /^Show only .*Florian/ }).click();
	await expect(ledger.getByText("Pasajes a Florianópolis")).toHaveCount(0);
	await expect(ledger.getByText("Mercado Praia")).toBeVisible();
});
