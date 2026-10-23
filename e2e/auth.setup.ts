import { test as setup } from "@playwright/test";
import {
	ADMIN_STORAGE_STATE,
	personaStorageState,
	USER_STORAGE_STATE,
} from "./constants";
import { LUCIA, MARTIN, SOFIA } from "./fixtures/personas";
import { loginAs, loginAsAdmin, loginAsTestUser } from "./helpers/auth";

setup("save test user auth state", async ({ page }) => {
	await loginAsTestUser(page);
	await page.context().storageState({ path: USER_STORAGE_STATE });
});

setup("save admin auth state", async ({ page }) => {
	await loginAsAdmin(page);
	await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});

for (const persona of [SOFIA, LUCIA, MARTIN]) {
	setup(`save ${persona.username} auth state`, async ({ page }) => {
		await loginAs(page, persona.email, persona.password);
		await page
			.context()
			.storageState({ path: personaStorageState(persona.username) });
	});
}
