import { expect, type Page, test } from "@playwright/test";
import { Pool } from "pg";
import { E2E_DATABASE_URL } from "../constants";
import { SOFIA } from "../fixtures/personas";
import { loginAs } from "../helpers/auth";
import { bannedOutputOn } from "../helpers/banned-output";
import { FigureAudit, httpFigureFetcher } from "../helpers/figures";
import { gotoReady } from "../helpers/navigation";
import { untilSaved } from "../helpers/trpc";

// The redesigned Settings page (S4H) with uiV2 on for everyone. The flag is
// read through a 60 s settings cache, so the page is polled until the new
// one shows.
const V2 = '[data-page="settings-v2"]';

test.beforeAll(async () => {
	const pool = new Pool({ connectionString: E2E_DATABASE_URL });
	try {
		await pool.query(
			`INSERT INTO "app_settings" (id, "uiV2Mode", "updatedAt")
			 VALUES ('app_settings_singleton', 'ALL', now())
			 ON CONFLICT (id) DO UPDATE SET "uiV2Mode" = 'ALL'`,
		);
	} finally {
		await pool.end();
	}
});

async function openSettings(page: Page) {
	await expect(async () => {
		await gotoReady(page, "/settings");
		await expect(page.locator(V2)).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 90_000, intervals: [3_000] });
}

test.describe("Settings v2", () => {
	test.describe.configure({ mode: "serial" });

	test("renders every section with no banned output or figure drift", async ({
		page,
	}) => {
		test.setTimeout(180_000);
		const errors: string[] = [];
		page.on("pageerror", (e) => errors.push(e.message));
		await page.setViewportSize({ width: 1440, height: 900 });
		await loginAs(page, SOFIA.email, SOFIA.password);
		await openSettings(page);

		const main = page.getByRole("main");
		for (const name of [
			"Profile",
			"Preferences",
			"Categories",
			"Payment methods",
			"Notifications",
			"Security",
			"Developer",
			"Data",
			"Danger zone",
		])
			await expect(main.getByRole("heading", { level: 2, name })).toBeVisible();
		// Monthly income is gone (IMPLEMENTATION §1.1).
		await expect(main.getByText(/monthly income/i)).toHaveCount(0);
		// Labels name their fields (GAPS §8).
		await expect(page.getByLabel("Display name")).toHaveValue(SOFIA.name);
		// The seeded categories are listed with their counts.
		await expect(main.getByText(/\d+ expenses?/).first()).toBeVisible();

		expect(await bannedOutputOn(page), "banned output").toEqual([]);
		const audit = new FigureAudit(httpFigureFetcher(page.request));
		expect(await audit.checkPage(page, "settings", "settings")).toEqual([]);

		// The section nav jumps and marks where you are.
		await page
			.getByRole("navigation", { name: "Settings sections" })
			.getByRole("link", { name: "Security" })
			.click();
		await expect(page).toHaveURL(/#security$/);
		expect(errors, "uncaught page errors").toEqual([]);
	});

	test("a switch saves on change, Undo puts it back, and it sticks", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await loginAs(page, SOFIA.email, SOFIA.password);
		await openSettings(page);

		const smart = page.getByRole("switch", { name: "Smart formatting" });
		const before = (await smart.getAttribute("aria-checked")) === "true";
		await untilSaved(page, "settings.updateGeneral", () => smart.click());
		await expect(smart).toHaveAttribute("aria-checked", String(!before));
		await expect(page.getByText("Saved", { exact: true })).toBeVisible();

		await gotoReady(page, "/settings");
		await expect(smart).toHaveAttribute("aria-checked", String(!before));

		await untilSaved(page, "settings.updateGeneral", () => smart.click());
		await expect(smart).toHaveAttribute("aria-checked", String(before));
		await untilSaved(page, "settings.updateGeneral", () =>
			page.getByRole("button", { name: "Undo" }).first().click(),
		);
		await expect(smart).toHaveAttribute("aria-checked", String(!before));
		// Leave it as the seed had it.
		await untilSaved(page, "settings.updateGeneral", () => smart.click());
		await expect(smart).toHaveAttribute("aria-checked", String(before));
	});

	test("an API key is shown once, listed read-only, and revoked with a named button", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await loginAs(page, SOFIA.email, SOFIA.password);
		await openSettings(page);

		await page.getByRole("button", { name: "New API key" }).click();
		const sheet = page.getByRole("dialog", { name: "New API key" });
		await sheet.getByLabel("Name").fill("e2e script");
		// Only read can be set until POST /api/v1/tokens exists.
		await expect(sheet.getByRole("checkbox").first()).toBeChecked();
		await expect(sheet.getByRole("checkbox").nth(1)).toBeDisabled();
		await sheet.getByRole("button", { name: "Create key" }).click();

		const shown = page.getByRole("dialog", { name: "Your new key" });
		await expect(shown.getByLabel("API key")).toHaveValue(/^rsk_/);
		await shown.getByRole("button", { name: "Done" }).click();

		const keys = page.getByRole("list", { name: "API keys" });
		await expect(keys.getByText("e2e script")).toBeVisible();
		await expect(keys.getByText("Read").first()).toBeVisible();

		await keys.getByRole("button", { name: "Actions for e2e script" }).click();
		await page.getByRole("menuitem", { name: "Revoke key" }).click();
		const confirm = page.getByRole("alertdialog", {
			name: "Revoke e2e script?",
		});
		await confirm.getByRole("button", { name: "Revoke key" }).click();
		await expect(keys.getByText("e2e script")).toHaveCount(0);
	});

	test("phone: section tabs and grouped rows at 390", async ({ page }) => {
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 390, height: 844 });
		await loginAs(page, SOFIA.email, SOFIA.password);
		await openSettings(page);
		const tabs = page.getByRole("navigation", { name: "Settings sections" });
		await expect(tabs.getByRole("link", { name: "Profile" })).toBeVisible();
		await tabs.getByRole("link", { name: "Notifications" }).click();
		await expect(page).toHaveURL(/#notifications$/);
		await expect(
			page.getByRole("group", { name: "Someone adds you to a split" }),
		).toBeVisible();
		expect(await bannedOutputOn(page), "banned output").toEqual([]);
	});
});
