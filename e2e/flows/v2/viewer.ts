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
 * A category made through the app, so the rows these flows add land in a
 * category no other flow counts. Returns its name.
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

/** An expense with no category, through the app's own write; returns its id. */
export async function uncategorizedExpense(page: Page, title: string) {
	const id = crypto.randomUUID();
	const res = await page.request.post("/api/trpc/expense.createExpense", {
		data: {
			json: {
				id,
				title,
				amount: 777,
				currency: "ARS",
				date: new Date().toISOString(),
			},
			meta: { values: { date: ["Date"] } },
		},
		headers: { Origin: new URL(page.url()).origin },
	});
	expect(res.ok(), `createExpense answered ${res.status()}`).toBe(true);
	return id;
}
