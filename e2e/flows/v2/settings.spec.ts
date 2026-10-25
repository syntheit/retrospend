import { expect, type Page, test } from "@playwright/test";
import { Pool } from "pg";
import { E2E_DATABASE_URL, personaStorageState } from "../../constants";
import { SOFIA } from "../../fixtures/personas";
import { bannedOutputOn } from "../../helpers/banned-output";
import { FigureAudit, httpFigureFetcher } from "../../helpers/figures";
import { gotoReady } from "../../helpers/navigation";
import { untilSaved } from "../../helpers/trpc";

// The redesigned Settings page (S4H), in Sofía's saved session. The
// flows-v2 project runs with uiV2 on for everyone (ui-v2-on.setup.ts).
const V2 = '[data-page="settings-v2"]';

test.use({ storageState: personaStorageState(SOFIA.username) });

async function openSettings(page: Page) {
	await gotoReady(page, "/settings");
	await expect(page.locator(V2)).toBeVisible();
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
		// Focus lands on the section heading, so keyboard users are there too.
		await expect(
			main.getByRole("heading", { level: 2, name: "Security" }),
		).toBeFocused();
		expect(errors, "uncaught page errors").toEqual([]);
	});

	test("?add=category opens the add form once and leaves the URL", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await openSettings(page);
		await gotoReady(page, "/settings?add=category");
		await expect(page.getByRole("dialog")).toBeVisible();
		await expect(page).not.toHaveURL(/add=category/);
		// A reload does not open it again.
		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await gotoReady(page, page.url());
		await expect(page.locator(V2)).toBeVisible();
		await page.waitForTimeout(1_000);
		await expect(page.getByRole("dialog")).toHaveCount(0);
	});

	test("approved devices list and disconnect by name", async ({ page }) => {
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		const pool = new Pool({ connectionString: E2E_DATABASE_URL });
		try {
			await pool.query(
				`INSERT INTO "session" (id, token, "userId", "expiresAt", "createdAt", "updatedAt", scopes, "clientId")
				 SELECT 'e2e-device-session', 'e2e-device-token-not-a-secret', id, now() + interval '1 day', now(), now(), 'read', 'retrospend-cli'
				 FROM "user" WHERE email = $1
				 ON CONFLICT (id) DO NOTHING`,
				[SOFIA.email],
			);
		} finally {
			await pool.end();
		}
		await openSettings(page);
		const devices = page.getByRole("list", { name: "Approved devices" });
		await expect(devices.getByText("Retrospend CLI")).toBeVisible();
		await devices
			.getByRole("button", { name: "More actions for Retrospend CLI" })
			.click();
		await page.getByRole("menuitem", { name: "Disconnect" }).click();
		await page
			.getByRole("alertdialog", { name: "Disconnect Retrospend CLI?" })
			.getByRole("button", { name: "Disconnect device" })
			.click();
		await expect(devices).toHaveCount(0);
		await expect(page.getByText("No approved devices")).toBeVisible();
	});

	test("a switch saves on change, Undo puts it back, and it sticks", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 1440, height: 900 });
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

	test("time zone: taken from the browser, saves with Undo", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await openSettings(page);

		// The browser runs in Buenos Aires (playwright.config timezoneId), and
		// the first signed-in request stores it.
		const zone = page.getByLabel("Time zone");
		await expect(zone).toContainText("Buenos Aires");

		await zone.click();
		await untilSaved(page, "settings.updateGeneral", () =>
			page.getByRole("option", { name: "Asia/Tokyo" }).click(),
		);
		await expect(zone).toContainText("Asia/Tokyo");
		await untilSaved(page, "settings.updateGeneral", () =>
			page.getByRole("button", { name: "Undo" }).first().click(),
		);
		await expect(zone).toContainText("Buenos Aires");
		await gotoReady(page, "/settings");
		await expect(page.getByLabel("Time zone")).toContainText("Buenos Aires");
	});

	test("an API key is shown once, listed read-only, and revoked with a named button", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 1440, height: 900 });
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

		await keys
			.getByRole("button", { name: "More actions for e2e script" })
			.click();
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
