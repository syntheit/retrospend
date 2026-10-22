import { expect, type Page } from "@playwright/test";

/** Procedures a tRPC request URL calls ("/api/trpc/a.b,c.d?batch=1"). */
function proceduresOf(url: string): string[] {
	const { pathname } = new URL(url);
	const prefix = "/api/trpc/";
	if (!pathname.startsWith(prefix)) return [];
	return pathname.slice(prefix.length).split(",");
}

/**
 * Runs `action` and waits until the server has answered `procedure`. Forms
 * close before their mutation returns, so a test that navigates right after
 * a save would otherwise cancel the request.
 */
export async function untilSaved(
	page: Page,
	procedure: string,
	action: () => Promise<void>,
): Promise<void> {
	const saved = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			proceduresOf(response.url()).includes(procedure),
	);
	await action();
	const response = await saved;
	expect(response.ok(), `${procedure} answered ${response.status()}`).toBe(
		true,
	);
}
