import { expect, test } from "@playwright/test";
import { bannedOutputOn } from "../../helpers/banned-output";
import { untilSaved } from "../../helpers/trpc";
import { auditFigures, openPage, SOFIA_SESSION } from "./projects-helpers";

// The redesigned Projects list (uiV2) on Sofía's seeded projects: Viaje a
// Florianópolis (BRL, four people) and Depto Palermo (ARS, with Martín).
// In Depto she paid ARS 279,600 of ARS 615,000, her share is ARS 307,500 and
// Martín paid her ARS 13,200, so she owes ARS 41,100 there.

test.use({ storageState: SOFIA_SESSION });

test("Projects: rows with balances, search, new project and archive with Undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openPage(page, "/projects", "projects");
	const main = page.getByRole("main");

	await expect(main.getByRole("heading", { name: "Projects" })).toBeVisible();
	const active = main.getByRole("list", { name: "Active" });
	const depto = active
		.getByRole("listitem")
		.filter({ hasText: "Depto Palermo" });
	await expect(depto).toContainText("you owe");
	await expect(depto).toContainText("ARS 41,100");
	await expect(
		active.getByRole("listitem").filter({ hasText: "Viaje a Florianópolis" }),
	).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	expect(await auditFigures(page, "projects", "projects-v2")).toEqual([]);

	// Search ignores accents.
	const search = main.getByRole("searchbox", { name: "Search projects" });
	await search.fill("florianopolis");
	await expect(main.getByText("Depto Palermo")).toHaveCount(0);
	await expect(main.getByText("Viaje a Florianópolis")).toBeVisible();
	await search.fill("");

	// New project, then Undo deletes it.
	await main.getByRole("button", { name: "New project" }).click();
	const sheet = page.getByRole("dialog", { name: "New project" });
	await sheet.getByRole("textbox", { name: "Name" }).fill("E2E escapada");
	await untilSaved(page, "project.create", () =>
		sheet.getByRole("button", { name: "Create project" }).click(),
	);
	await expect(active.getByText("E2E escapada")).toBeVisible();
	await untilSaved(page, "project.delete", () =>
		page
			.locator("[data-sonner-toast]")
			.filter({ hasText: "Created E2E escapada" })
			.getByRole("button", { name: "Undo" })
			.click(),
	);
	await expect(main.getByText("E2E escapada")).toHaveCount(0);

	// Archive moves Depto under its year; Undo brings it back.
	await depto
		.getByRole("button", { name: "More actions for Depto Palermo" })
		.click();
	await untilSaved(page, "project.update", () =>
		page.getByRole("menuitem", { name: "Archive" }).click(),
	);
	await expect(active.getByText("Depto Palermo")).toHaveCount(0);
	await expect(
		main.getByRole("list", { name: /Past projects from/ }),
	).toContainText("Depto Palermo");
	await untilSaved(page, "project.update", () =>
		page
			.locator("[data-sonner-toast]")
			.filter({ hasText: "Archived Depto Palermo" })
			.getByRole("button", { name: "Undo" })
			.click(),
	);
	await expect(active.getByText("Depto Palermo")).toBeVisible();
});
