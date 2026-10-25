import { expect, type Page } from "@playwright/test";
import { personaStorageState } from "../constants";
import { SOFIA } from "../fixtures/personas";
import { FigureAudit, httpFigureFetcher } from "../helpers/figures";
import { gotoReady } from "../helpers/navigation";

/**
 * Shared steps of the Projects and Project flows. auth.setup.ts saved Sofía's session.
 * The pages tag figures as `<figure id>:<projectId>[:<personId>]`;
 * httpFigureFetcher reads them back from /api/v1/figures with that scope.
 */
export const SOFIA_SESSION = personaStorageState(SOFIA.username);

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

/** Opens `path` and checks it is the redesigned page `label`. */
export async function openPage(
	page: Page,
	path: string,
	label: string,
): Promise<void> {
	await gotoReady(page, path);
	await expect(
		page.locator(`[data-ui="v2"][data-page="${label}"]`),
	).toBeVisible();
}
