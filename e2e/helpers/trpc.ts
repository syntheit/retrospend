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
 *
 * The client batches with httpBatchStreamLink: the 200 and its headers go
 * out before the procedure has run, and the result follows in the streamed
 * body. A navigation between the two aborts the request and the server
 * drops the mutation (a project or expense that never lands). So this waits
 * until the whole body has arrived.
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
	// The whole streamed body, not just the headers. Once the client has its
	// result it may cancel the rest of the stream (Chromium then reports
	// ERR_ABORTED or never reports an end), so the wait is capped and a
	// cancelled stream is not an error here.
	await Promise.race([
		response.finished(),
		new Promise((resolve) => setTimeout(resolve, STREAM_END_MS)),
	]);
}

/** How long untilSaved waits for a streamed answer to end. */
const STREAM_END_MS = 5_000;
