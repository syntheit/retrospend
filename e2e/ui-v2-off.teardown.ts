import { test as teardown } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "./constants";
import { setUiV2Mode } from "./helpers/ui-v2";

teardown.use({ storageState: ADMIN_STORAGE_STATE });

// A reused dev server (E2E_REUSE_SERVER=1) would otherwise keep serving the
// new pages to the next run's legacy specs from its settings cache.
teardown("turn uiV2 off again", async ({ page }) => {
	await setUiV2Mode(page.request, "OFF");
});
