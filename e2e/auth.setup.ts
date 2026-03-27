import { test as setup } from "@playwright/test";
import {
	ADMIN_STORAGE_STATE,
	ADMIN_USER,
	TEST_USER,
	USER_STORAGE_STATE,
} from "./constants";

setup("save test user auth state", async ({ page }) => {
	await page.goto("/login");
	await page.fill("#email", TEST_USER.email);
	await page.fill("#password", TEST_USER.password);
	await page.click('button[type="submit"]');
	await page.waitForURL(/\/dashboard/);
	await page.context().storageState({ path: USER_STORAGE_STATE });
});

setup("save admin auth state", async ({ page }) => {
	await page.goto("/login");
	await page.fill("#email", ADMIN_USER.email);
	await page.fill("#password", ADMIN_USER.password);
	await page.click('button[type="submit"]');
	await page.waitForURL(/\/dashboard/);
	await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});
