import { expect, type Page, request } from "@playwright/test";
import { Pool } from "pg";
import { ADMIN_USER, E2E_BASE_URL, E2E_DATABASE_URL } from "../constants";
import { SOFIA } from "../fixtures/personas";
import { loginAs } from "../helpers/auth";
import {
	type ApiFigure,
	collectFigureTags,
	FigureAudit,
	type FigureFetcher,
} from "../helpers/figures";
import { gotoReady } from "../helpers/navigation";

/**
 * Shared steps of the Projects and Project flows (uiV2).
 *
 * The project pages tag figures as `<figure id>:<projectId>[:<personId>]`
 * (personId is "type:id"). /api/v1/figures takes the bare id with the
 * narrowing as query parameters and answers per-currency lines, so this
 * fetcher asks it once per tag and picks the line in the currency the page
 * shows (a figure with no line in it is zero). httpFigureFetcher speaks an
 * older shape of the endpoint; the S6 audit owner aligns the two.
 */
export function projectFigureFetcher(
	page: Page,
	currencies: Map<string, string>,
): FigureFetcher {
	return async (ids) => {
		const figures: ApiFigure[] = [];
		const missing: string[] = [];
		for (const tag of ids) {
			const [id, projectId, ...person] = tag.split(":");
			const query = new URLSearchParams({
				ids: id ?? "",
				projectId: projectId ?? "",
			});
			if (person.length) query.set("personId", person.join(":"));
			const res = await page.request.get(`/api/v1/figures?${query}`);
			if (!res.ok())
				throw new Error(
					`GET /api/v1/figures for ${tag} answered ${res.status()}: ${await res.text()}`,
				);
			const body = (await res.json()) as {
				figures: {
					id: string;
					lines: { minor: number; currency: string }[] | null;
				}[];
			};
			const lines = body.figures[0]?.lines;
			const currency = currencies.get(tag) ?? "";
			if (!lines) {
				missing.push(tag);
				continue;
			}
			const line = lines.find((l) => l.currency === currency);
			figures.push({
				id: tag,
				unit: "money",
				minor: line?.minor ?? 0,
				currency,
			});
		}
		return { figures, missing };
	};
}

/** The figure audit for the page as it is now: screen vs /api/v1/figures. */
export async function auditFigures(
	page: Page,
	label: string,
): Promise<string[]> {
	const rendered = await collectFigureTags(page);
	const currencies = new Map(
		rendered.tags.map((t) => [t.id ?? "", t.currency ?? ""]),
	);
	const audit = new FigureAudit(projectFigureFetcher(page, currencies));
	return audit.checkRendered(label, rendered, []);
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
