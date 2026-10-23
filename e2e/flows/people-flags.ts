import { type Browser, expect } from "@playwright/test";
import { Pool } from "pg";
import { ADMIN_USER, E2E_BASE_URL, E2E_DATABASE_URL } from "../constants";

/**
 * uiV2 and apiV1 on for everyone in this test database (the People page
 * tags figures, and the audit reads them back from /api/v1/figures), then an
 * admin settings write, which re-reads the row into the server's 60-second
 * cache. Shared by the People, Person and Settle up flows.
 */
export async function enablePeopleV2(browser: Browser): Promise<void> {
	const pool = new Pool({ connectionString: E2E_DATABASE_URL });
	try {
		await pool.query(
			`INSERT INTO "app_settings" (id, "updatedAt", "uiV2Mode", "apiV1Mode") VALUES ('app_settings_singleton', now(), 'ALL', 'ALL')
			 ON CONFLICT (id) DO UPDATE SET "uiV2Mode" = 'ALL', "apiV1Mode" = 'ALL'`,
		);
	} finally {
		await pool.end();
	}
	const context = await browser.newContext({ baseURL: E2E_BASE_URL });
	const origin = { Origin: E2E_BASE_URL };
	const signIn = await context.request.post("/api/auth/sign-in/email", {
		data: { email: ADMIN_USER.email, password: ADMIN_USER.password },
		headers: origin,
	});
	expect(signIn.ok(), "admin sign-in").toBe(true);
	const refresh = await context.request.post(
		"/api/trpc/admin.updateSettings?batch=1",
		{ data: { 0: { json: {} } }, headers: origin },
	);
	expect(refresh.ok(), "settings cache refresh").toBe(true);
	await context.close();
}
