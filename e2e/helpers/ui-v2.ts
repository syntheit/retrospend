import { type APIRequestContext, expect } from "@playwright/test";
import { Pool } from "pg";
import { E2E_BASE_URL, E2E_DATABASE_URL } from "../constants";

/**
 * Sets the app-wide uiV2 mode, then makes an admin settings write, which
 * re-reads the row into the server's 60 second settings cache. `request`
 * must carry an admin session.
 *
 * The mode is one row for the whole database, so only the ui-v2 setup and
 * teardown projects call this, while nothing else runs (playwright.config.ts).
 */
export async function setUiV2Mode(
	request: APIRequestContext,
	mode: "OFF" | "ALL",
): Promise<void> {
	const pool = new Pool({ connectionString: E2E_DATABASE_URL });
	try {
		await pool.query(
			`INSERT INTO "app_settings" (id, "updatedAt", "uiV2Mode") VALUES ('app_settings_singleton', now(), $1)
			 ON CONFLICT (id) DO UPDATE SET "uiV2Mode" = $1`,
			[mode],
		);
	} finally {
		await pool.end();
	}
	const refresh = await request.post("/api/trpc/admin.updateSettings?batch=1", {
		data: { 0: { json: {} } },
		headers: { Origin: E2E_BASE_URL },
	});
	expect(refresh.ok(), "settings cache refresh").toBe(true);
}
