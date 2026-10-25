import { type APIRequestContext, expect } from "@playwright/test";
import { Pool } from "pg";
import { E2E_BASE_URL, E2E_DATABASE_URL } from "../constants";

/**
 * Sets the app-wide envelope budget mode, then makes an admin settings write,
 * which re-reads the row into the server's 60 second settings cache.
 * `request` must carry an admin session. The mode is one row for the whole
 * database, so a spec that turns it on turns it off again when it is done.
 */
export async function setEnvelopeBudgetMode(
	request: APIRequestContext,
	mode: "OFF" | "ALL",
): Promise<void> {
	const pool = new Pool({ connectionString: E2E_DATABASE_URL });
	try {
		await pool.query(
			`INSERT INTO "app_settings" (id, "updatedAt", "envelopeBudgetMode") VALUES ('app_settings_singleton', now(), $1)
			 ON CONFLICT (id) DO UPDATE SET "envelopeBudgetMode" = $1`,
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
