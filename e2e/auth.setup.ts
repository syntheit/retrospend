import { test as setup } from "@playwright/test";
import { ADMIN_STORAGE_STATE, USER_STORAGE_STATE } from "./constants";
import { loginAsAdmin, loginAsTestUser } from "./helpers/auth";

setup("save test user auth state", async ({ page }) => {
	await loginAsTestUser(page);
	await page.context().storageState({ path: USER_STORAGE_STATE });
});

setup("save admin auth state", async ({ page }) => {
	await loginAsAdmin(page);
	await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});
