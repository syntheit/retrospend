import { expect, test } from "@playwright/test";
import { TEST_USER, USER_STORAGE_STATE } from "../constants";
import { bannedOutputOn } from "../helpers/banned-output";
import { gotoReady } from "../helpers/navigation";

// A brand-new account (no ledger, no people, no accounts) on every page: each
// one renders its empty state without an error, banned output or a crash.

test.use({ storageState: USER_STORAGE_STATE });

const PAGES = [
	"/home",
	"/activity",
	"/budget",
	"/people",
	"/projects",
	"/wealth",
	"/currencies",
	"/import",
	"/settings",
];

test("a new account opens every page", async ({ page }) => {
	test.setTimeout(300_000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	for (const path of PAGES) {
		await test.step(path, async () => {
			await gotoReady(page, path);
			const main = page.getByRole("main");
			await expect(main).not.toHaveText(/^\s*$/);
			await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
			expect(await bannedOutputOn(page), `${path}: banned output`).toEqual([]);
		});
	}
	expect(errors, "uncaught page errors").toEqual([]);
});

test("the sidebar names the account", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await gotoReady(page, "/home");
	await expect(page.getByRole("button", { name: /Account menu/ })).toContainText(
		TEST_USER.name,
	);
});
