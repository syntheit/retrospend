/**
 * The e2e `test`, with one addition for sealed runs (E2E_SEALED=1, E2EE D11
 * PR 9.2): any `/api` JSON response that holds a string starting with U+0001
 * fails the test. A sealed value must never leave the server (design section
 * 7.1), and the server's own response guard runs only under NODE_ENV=test,
 * not in `next dev`, so the browser side checks every response here.
 *
 * Where it looks:
 * - the page's own `fetch` calls. The app's tRPC client batches with
 *   httpBatchStreamLink, and Chromium cannot hand a streamed body to
 *   `response.text()` ("No data found for resource"), so an init script wraps
 *   `window.fetch` in every watched context, reads a clone of each `/api` JSON
 *   response there (the original streams on, untouched) and reports the text
 *   back through an exposed binding. A tRPC body is JSON lines, read line by
 *   line (helpers/sealed-paths.ts);
 * - the `response` event of the context, for what is not a page fetch;
 * - `page.request` and `context.request`, the `request` fixture, request
 *   contexts from `playwright.request.newContext` (the API-token specs), and
 *   contexts a test opens itself with `browser.newContext`.
 *
 * A 2xx JSON response the guard cannot read as JSON or JSON lines fails the
 * test, so an unreadable format is never a pass. A failure names the method,
 * the path and the JSON path of the string, never its value. Unsealed runs
 * pass everything through untouched.
 *
 * Specs import `test` and `expect` from here instead of @playwright/test; the
 * rest of that module is re-exported.
 */
import {
	type APIRequestContext,
	type APIResponse,
	type Browser,
	type BrowserContext,
	test as base,
	type PlaywrightWorkerArgs,
	type Response,
} from "@playwright/test";
import { E2E_SEALED } from "../constants";
import { sealedPathsInBody } from "../helpers/sealed-paths";

export * from "@playwright/test";

// One worker runs one test at a time, so module state is the current test's.
const leaks: string[] = [];
const unreadable: string[] = [];
const pending = new Set<Promise<void>>();

/**
 * What the guard has looked at in this worker. A spec that drives the UI
 * checks `pageTrpc` rose, so a guard that sees nothing cannot pass.
 */
export const guardStats = { pageTrpc: 0, inspected: 0, unreadable: 0 };

interface Seen {
	method: string;
	url: string;
	status: number;
	contentType: string | undefined;
}

/** Checks one body that has been read. */
function check(seen: Seen, text: string, fromPage: boolean): void {
	const { pathname } = new URL(seen.url);
	guardStats.inspected++;
	if (fromPage && pathname.startsWith("/api/trpc/")) guardStats.pageTrpc++;
	try {
		for (const at of sealedPathsInBody(text))
			leaks.push(`${seen.method} ${pathname} ${at}`);
	} catch {
		// A body the guard cannot read is a hole, never a pass.
		if (seen.status >= 200 && seen.status < 300)
			unreadable.push(`${seen.method} ${pathname}`);
	}
}

const watchesBody = (seen: Seen): boolean =>
	new URL(seen.url).pathname.startsWith("/api/") &&
	seen.contentType?.includes("json") === true;

/** Reads a body the Node side can reach and checks it. */
function inspect(
	seen: Seen,
	read: () => Promise<string>,
	fromPage = false,
): void {
	if (!watchesBody(seen)) return;
	const job = read().then(
		(text) => check(seen, text, fromPage),
		// A redirect, a page that closed mid-stream, a streamed body.
		() => {
			guardStats.unreadable++;
		},
	);
	pending.add(job);
	void job.finally(() => pending.delete(job));
}

const inspectResponse = (response: Response): void =>
	inspect(
		{
			method: response.request().method(),
			url: response.url(),
			status: response.status(),
			contentType: response.headers()["content-type"],
		},
		() => response.text(),
	);

const REQUEST_METHODS = new Set([
	"get",
	"post",
	"put",
	"patch",
	"delete",
	"head",
	"fetch",
]);

/** The same request context, reporting what its responses hold. */
function guardRequest(request: APIRequestContext): APIRequestContext {
	return new Proxy(request, {
		get(target, prop) {
			const value: unknown = Reflect.get(target, prop, target);
			if (typeof value !== "function") return value;
			if (typeof prop !== "string" || !REQUEST_METHODS.has(prop))
				return value.bind(target);
			return async (url: string, ...rest: unknown[]) => {
				const response = (await value.call(
					target,
					url,
					...rest,
				)) as APIResponse;
				inspect(
					{
						method: prop.toUpperCase(),
						url: response.url(),
						status: response.status(),
						contentType: response.headers()["content-type"],
					},
					() => response.text(),
				);
				return response;
			};
		},
	});
}

type PageGuard = {
	__sealedGuard?: (report: Seen & { text: string }) => void;
	__sealedGuardPending?: Set<Promise<unknown>>;
};

/**
 * Runs in every page of a watched context, before the app. Wraps `fetch` so
 * the body of each `/api` JSON response is read here as the app reads it, and
 * sent to the binding once the stream ends. The app gets an equal response
 * made from a stream that passes every chunk through.
 *
 * A clone read on the side does not work: the tRPC client aborts its fetch as
 * soon as it has its results, which kills the clone's read too. Reading as
 * the app does sees every chunk the app received. An aborted stream reports
 * what arrived, cut back to its last complete JSON line.
 */
function installFetchTap(): void {
	const w = window as unknown as PageGuard & { fetch: typeof fetch };
	const pending = new Set<Promise<unknown>>();
	w.__sealedGuardPending = pending;
	const original = w.fetch.bind(window);
	w.fetch = async (input, init) => {
		const response = await original(input, init);
		try {
			const request = input instanceof Request ? input : null;
			const url = new URL(
				response.url || String(request?.url ?? input),
				location.href,
			);
			const contentType = response.headers.get("content-type") ?? undefined;
			if (
				!response.body ||
				!url.pathname.startsWith("/api/") ||
				!contentType?.includes("json")
			)
				return response;
			const seen = {
				method: (init?.method ?? request?.method ?? "GET").toUpperCase(),
				url: url.href,
				status: response.status,
				contentType,
			};
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let text = "";
			let done = false;
			let finish: () => void = () => undefined;
			const job = new Promise<void>((resolve) => {
				finish = resolve;
			});
			pending.add(job);
			const report = (aborted: boolean) => {
				if (done) return;
				done = true;
				text += decoder.decode();
				w.__sealedGuard?.({
					...seen,
					text: aborted ? text.slice(0, text.lastIndexOf("\n") + 1) : text,
				});
				pending.delete(job);
				finish();
			};
			const body = new ReadableStream<Uint8Array>({
				async pull(controller) {
					try {
						const chunk = await reader.read();
						if (chunk.done) {
							report(false);
							controller.close();
							return;
						}
						text += decoder.decode(chunk.value, { stream: true });
						controller.enqueue(chunk.value);
					} catch (error) {
						report(true);
						controller.error(error);
					}
				},
				cancel(reason) {
					report(true);
					return reader.cancel(reason);
				},
			});
			const tapped = new Response(body, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			});
			Object.defineProperty(tapped, "url", { value: response.url });
			return tapped;
		} catch {
			// Never let the tap break the app's own request.
			return response;
		}
	};
}

/** Contexts of the current test, so their taps can be flushed at its end. */
const tapped = new Set<BrowserContext>();
const watched = new WeakSet<BrowserContext>();

async function watch(context: BrowserContext): Promise<BrowserContext> {
	if (watched.has(context)) return context;
	watched.add(context);
	tapped.add(context);
	context.on("response", inspectResponse);
	Object.defineProperty(context, "request", {
		value: guardRequest(context.request),
	});
	await context.exposeBinding(
		"__sealedGuard",
		(_source, report: Seen & { text: string }) => {
			check(report, report.text, true);
		},
	);
	await context.addInitScript(installFetchTap);
	return context;
}

/** Waits for the page taps to finish reading what the test's pages fetched. */
async function flushTaps(): Promise<void> {
	for (const context of tapped)
		for (const page of context.pages())
			if (!page.isClosed())
				await within(
					2500,
					page
						.evaluate(async () => {
							const open = (window as unknown as PageGuard)
								.__sealedGuardPending;
							if (!open) return;
							await Promise.race([
								Promise.allSettled([...open]),
								new Promise((resolve) => setTimeout(resolve, 2000)),
							]);
						})
						// A closed page has nothing left to read.
						.catch(() => undefined),
				);
	tapped.clear();
	// The binding calls land after the page's promises settle.
	await within(2500, Promise.all(pending));
}

/** Waits for `job`, but never longer than `ms`: a page that is busy or gone must not hold a test's teardown. */
const within = (ms: number, job: Promise<unknown>): Promise<unknown> =>
	Promise.race([job, new Promise((resolve) => setTimeout(resolve, ms))]);

/** A browser whose own contexts and pages are watched too. */
function guardBrowser(browser: Browser): Browser {
	const newContext = browser.newContext.bind(browser);
	const newPage = browser.newPage.bind(browser);
	browser.newContext = async (options) => watch(await newContext(options));
	browser.newPage = async (options) => {
		const page = await newPage(options);
		await watch(page.context());
		return page;
	};
	return browser;
}

/** `playwright.request.newContext` answers with a guarded request context. */
function guardPlaywright(
	playwright: PlaywrightWorkerArgs["playwright"],
): PlaywrightWorkerArgs["playwright"] {
	const newContext = playwright.request.newContext.bind(playwright.request);
	playwright.request.newContext = async (options) =>
		guardRequest(await newContext(options));
	return playwright;
}

export const test = base.extend<{ sealedGuard: void }>({
	playwright: [
		async ({ playwright }, use) => {
			await use(E2E_SEALED ? guardPlaywright(playwright) : playwright);
		},
		{ scope: "worker" },
	],
	browser: [
		async ({ browser }, use) => {
			await use(E2E_SEALED ? guardBrowser(browser) : browser);
		},
		{ scope: "worker" },
	],
	context: async ({ context }, use) => {
		if (!E2E_SEALED) return use(context);
		await watch(context);
		await use(context);
		// Before the context closes with its pages: reads still in flight go
		// out through the binding now.
		await flushTaps();
	},
	request: async ({ request }, use) => {
		await use(E2E_SEALED ? guardRequest(request) : request);
	},
	sealedGuard: [
		// Playwright wants a destructured first argument; browserName costs nothing.
		async ({ browserName }, use) => {
			void browserName;
			leaks.length = 0;
			unreadable.length = 0;
			await use();
			if (!E2E_SEALED) return;
			await flushTaps();
			if (leaks.length > 0)
				throw new Error(
					`A sealed value (U+0001) left the server in ${leaks.length} response(s): ${[...new Set(leaks)].join("; ")}`,
				);
			if (unreadable.length > 0)
				throw new Error(
					`The guard could not read ${unreadable.length} successful JSON response(s) as JSON or JSON lines: ${[...new Set(unreadable)].join("; ")}`,
				);
		},
		{ auto: true },
	],
});
