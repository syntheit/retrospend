import { test as setup } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "./constants";
import { setUiV2Mode } from "./helpers/ui-v2";

setup.use({ storageState: ADMIN_STORAGE_STATE });

setup("turn uiV2 on for everyone", async ({ page }) => {
	await setUiV2Mode(page.request, "ALL");
});
