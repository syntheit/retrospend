/**
 * Turns the new UI on for one persona only, so the flows can open v2 pages
 * while the other flows keep today's pages: uiV2Mode = ADMINS and Martín
 * (who no other flow signs in as) made an admin. Both writes are idempotent,
 * so parallel specs can call this, and the next run's seed wipes them.
 */
import { expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { E2E_DATABASE_URL } from "../constants";
import { MARTIN } from "../fixtures/personas";
import { loginAs } from "../helpers/auth";
import { gotoReady } from "../helpers/navigation";

export const V2_VIEWER = MARTIN;

export async function enableV2ForViewer(): Promise<void> {
	const pool = new Pool({ connectionString: E2E_DATABASE_URL });
	try {
		await pool.query(
			`INSERT INTO "app_settings" (id, "updatedAt", "uiV2Mode")
			 VALUES ('app_settings_singleton', now(), 'ADMINS')
			 ON CONFLICT (id) DO UPDATE SET "uiV2Mode" = 'ADMINS'`,
		);
		await pool.query(`UPDATE "user" SET role = 'ADMIN' WHERE id = $1`, [
			V2_VIEWER.id,
		]);
	} finally {
		await pool.end();
	}
}

/**
 * A category made through the app, for today's modals: they validate ids as
 * cuids, and the seed's readable ids are not. Returns its name.
 */
export async function realCategory(page: Page, name: string): Promise<string> {
	const origin = new URL(page.url()).origin;
	await page.request.post("/api/trpc/categories.create", {
		data: { json: { name, color: "teal" } },
		headers: { Origin: origin },
	});
	return name;
}

/**
 * Signs in as the v2 viewer and opens `path`, waiting out the server's
 * 60 second settings cache: until it sees the new mode the route is a 404.
 */
export async function openV2(page: Page, path: string): Promise<void> {
	await loginAs(page, V2_VIEWER.email, V2_VIEWER.password);
	await expect(async () => {
		await gotoReady(page, path);
		await expect(page.locator('[data-ui="v2"]')).toBeVisible({
			timeout: 5_000,
		});
	}).toPass({ timeout: 90_000, intervals: [5_000] });
}
