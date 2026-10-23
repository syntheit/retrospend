import { expect, test } from "@playwright/test";
import { PROJECT_IDS } from "../../fixtures/personas";
import { bannedOutputOn } from "../../helpers/banned-output";
import { gotoReady } from "../../helpers/navigation";
import { untilSaved } from "../../helpers/trpc";
import { auditFigures, openPage, SOFIA_SESSION } from "./projects-helpers";

// The redesigned project page (uiV2) on Depto Palermo, by hand from the seed
// (e2e/fixtures/ledger.ts): seven ARS expenses split in half between Sofía
// and Martín, ARS 615,000 in all. Sofía paid ARS 279,600 and Martín ARS
// 335,400; each share is ARS 307,500. Martín paid Sofía ARS 13,200, so her
// balance is 279,600 - 307,500 - 13,200 = -41,100: she pays Martín ARS
// 41,100, the one transfer that settles the group.

const DEPTO = `/projects/${PROJECT_IDS.depto}`;

test.use({ storageState: SOFIA_SESSION });

test.describe.configure({ mode: "serial" });

test("Project: hero, expenses and the Summary recomputed by hand", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openPage(page, DEPTO, "project");
	const main = page.getByRole("main");

	await expect(
		main.getByRole("heading", { name: "Depto Palermo" }),
	).toBeVisible();
	await expect(main.getByText("Group total")).toBeVisible();
	await expect(main.getByText("ARS 615,000").first()).toBeVisible();
	await expect(main.getByText("7 expenses").first()).toBeVisible();
	await expect(main.getByText("ARS 307,500").first()).toBeVisible();
	await expect(
		main.getByRole("row").filter({ hasText: "Arreglo del calefón" }),
	).toContainText("ARS 108,600");
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	expect(await auditFigures(page, "project", "project-v2")).toEqual([]);

	await main
		.getByRole("searchbox", { name: "Search expenses" })
		.fill("electricidad");
	await expect(main.getByText("2 of 7 expenses")).toBeVisible();

	await main.getByRole("link", { name: "Summary" }).click();
	await expect(
		main.getByRole("heading", { name: "Who paid what" }),
	).toBeVisible();
	const bars = main.getByRole("list", { name: /ARS/ }).first();
	await expect(bars).toContainText("ARS 279,600");
	await expect(bars).toContainText("ARS 335,400");
	await expect(
		main.getByText("Both add up to the group total, ARS 615,000."),
	).toBeVisible();
	const transfers = main.getByRole("list", { name: "Who pays whom" });
	await expect(transfers).toContainText("You pay Martín Acosta");
	await expect(transfers).toContainText("ARS 41,100");
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	expect(
		await auditFigures(page, "project summary", "project-v2-summary"),
	).toEqual([]);
});

test("Project: Settle all previews, records and undoes", async ({ page }) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openPage(page, `${DEPTO}?tab=summary`, "project");
	const main = page.getByRole("main");
	await main.getByRole("button", { name: "Settle all" }).click();
	const sheet = page.getByRole("dialog", { name: "Settle all" });
	await expect(sheet).toContainText("You pay Martín Acosta");
	await expect(sheet).toContainText("ARS 41,100");
	await expect(sheet.getByText("What stays the same")).toBeVisible();
	await expect(sheet).toContainText("Group total");
	await untilSaved(page, "project.settleAll", () =>
		sheet.getByRole("button", { name: "Record 1 payment" }).click(),
	);
	await expect(
		main.getByText("Everyone is even in this project."),
	).toBeVisible();
	await untilSaved(page, "project.settleAllUndo", () =>
		page
			.locator("[data-sonner-toast]")
			.filter({ hasText: "Recorded 1 payment" })
			.getByRole("button", { name: "Undo" })
			.click(),
	);
	await expect(main.getByRole("list", { name: "Who pays whom" })).toContainText(
		"ARS 41,100",
	);
});

test("Project: add a person from a day, then Undo", async ({ page }) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openPage(page, `${DEPTO}?tab=people`, "project");
	const main = page.getByRole("main");
	await main.getByRole("button", { name: "Add person" }).click();
	const sheet = page.getByRole("dialog", {
		name: "Add person to Depto Palermo",
	});
	await sheet.getByRole("textbox", { name: "Name" }).fill("Sol García");
	await untilSaved(page, "project.addParticipant", () =>
		sheet.getByRole("button", { name: "Add to project" }).click(),
	);
	const people = main.getByRole("list", { name: "People" });
	await expect(people).toContainText("Sol García");
	await untilSaved(page, "project.removeParticipant", () =>
		page
			.locator("[data-sonner-toast]")
			.filter({ hasText: "Sol García joins Depto Palermo" })
			.getByRole("button", { name: "Undo" })
			.click(),
	);
	await expect(people).not.toContainText("Sol García");
	await gotoReady(page, `${DEPTO}?tab=people`);
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
});
