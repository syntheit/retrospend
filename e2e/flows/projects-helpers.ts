import { expect, type Page, request } from "@playwright/test";
import { Pool } from "pg";
import { ADMIN_USER, E2E_BASE_URL, E2E_DATABASE_URL } from "../constants";
import { SOFIA } from "../fixtures/personas";
import { loginAs } from "../helpers/auth";
import { FigureAudit, httpFigureFetcher } from "../helpers/figures";
import { gotoReady } from "../helpers/navigation";

/**
 * Shared steps of the Projects and Project flows (uiV2). The pages tag
 * figures as `<figure id>:<projectId>[:<personId>]`; httpFigureFetcher reads
 * them back from /api/v1/figures with that narrowing.
 */

/** The figure audit for the page as it is now, with `pageKey`'s required ids. */
export async function auditFigures(
	page: Page,
	label: string,
	pageKey: string,
): Promise<string[]> {
	return new FigureAudit(httpFigureFetcher(page.request)).checkPage(
		page,
		label,
		pageKey,
	);
}

/** uiV2 and the v1 API on for everyone in this test database. */
export async function enableFlags(): Promise<void> {
	const pool = new Pool({ connectionString: E2E_DATABASE_URL });
	try {
		await pool.query(
			`INSERT INTO "app_settings" (id, "updatedAt", "uiV2Mode", "apiV1Mode") VALUES ('app_settings_singleton', now(), 'ALL', 'ALL')
			 ON CONFLICT (id) DO UPDATE SET "uiV2Mode" = 'ALL', "apiV1Mode" = 'ALL'`,
		);
	} finally {
		await pool.end();
	}
	// Any admin settings write re-reads the row into the server's 60 s cache.
	const api = await request.newContext({ baseURL: E2E_BASE_URL });
	const origin = { Origin: E2E_BASE_URL };
	const signIn = await api.post("/api/auth/sign-in/email", {
		data: { email: ADMIN_USER.email, password: ADMIN_USER.password },
		headers: origin,
	});
	expect(signIn.ok(), "admin sign-in").toBe(true);
	const refresh = await api.post("/api/trpc/admin.updateSettings?batch=1", {
		data: { 0: { json: {} } },
		headers: origin,
	});
	expect(refresh.ok(), "settings cache refresh").toBe(true);
	await api.dispose();
}

/** Signs Sofía in and opens `path` once the v2 page (data-page) shows; the flag cache can lag 60 s. */
export async function openAsSofia(
	page: Page,
	path: string,
	label: string,
): Promise<void> {
	await loginAs(page, SOFIA.email, SOFIA.password);
	await expect(async () => {
		await gotoReady(page, path);
		await expect(
			page.locator(`[data-ui="v2"][data-page="${label}"]`),
		).toBeVisible({
			timeout: 2_000,
		});
	}).toPass({ timeout: 90_000, intervals: [3_000] });
}
