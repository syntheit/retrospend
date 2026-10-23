/**
 * The persona the Activity and Recurring flows run as: Martín, whom no other
 * flow uses, so the rows these flows add touch nobody else's figures. The
 * flows-v2 project turns uiV2 on for everyone (ui-v2-on.setup.ts) and
 * auth.setup.ts saved his session.
 */
import { expect, type Page } from "@playwright/test";
import { personaStorageState } from "../../constants";
import { MARTIN } from "../../fixtures/personas";
import { gotoReady } from "../../helpers/navigation";

export const V2_VIEWER = MARTIN;
export const V2_VIEWER_SESSION = personaStorageState(MARTIN.username);

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

/** Opens `path` and checks it is the new page. */
export async function openV2(page: Page, path: string): Promise<void> {
	await gotoReady(page, path);
	await expect(page.locator('[data-ui="v2"]')).toBeVisible();
}
