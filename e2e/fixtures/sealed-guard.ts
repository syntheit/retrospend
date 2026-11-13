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
export const guardStats = {
	pageTrpc: 0,
	inspected: 0,
	unreadable: 0,
	/** `/api` fetches still waiting for response headers when a flush froze the page. */
	noBody: 0,
};

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
		() => {
			guardStats.unreadable++;
			// A redirect has no body; a 2xx body the guard cannot read is a hole.
			if (seen.status >= 200 && seen.status < 300)
				unreadable.push(
					`${seen.method} ${new URL(seen.url).pathname} (body unreadable)`,
				);
		},
	);
	pending.add(job);
	void job.finally(() => pending.delete(job));
}

// A page's own fetch calls are read by the tap (installFetchTap): their
// streamed bodies cannot be read from the response event. What is left here is
// everything else the page loads.
const inspectResponse = (response: Response): void =>
	response.request().resourceType() === "fetch"
		? undefined
		: inspect(
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
	__sealedGuard?: (report: Seen & { text: string }) => Promise<void>;
	/**
	 * Reports every read still open and answers with the counts of that one
	 * moment: reads started, reads reported, and `/api` fetches that had no
	 * response yet (nothing to read, accounted for as such).
	 */
	__sealedGuardFlush?: (
		waitMs: number,
	) => Promise<{ started: number; reported: number; noBody: number }>;
};

/**
 * Runs in every page of a watched context, before the app. Wraps `fetch` so
 * the body of each `/api` JSON response is read here, whatever the app does
 * with it, and sent to the binding.
 *
 * The body is tee'd: the app gets one branch and the guard reads the other to
 * the end on its own, so an app that checks only `res.ok` and never reads the
 * body hides nothing. A clone read on the side is no use: the tRPC client
 * aborts its fetch as soon as it has its results, which kills it. The guard's
 * branch survives that by reporting what arrived, cut to its last complete
 * line. Reads still open at flush or `pagehide` are reported the same way.
 * The flush says how many reads started and how many reported, and a
 * difference fails the test (flushTaps). The counts are taken in the same
 * synchronous step as the last report, so a read the app starts while the
 * flush is still waiting on the binding is not a read that was dropped: it
 * started after the freeze. A fetch that has no response yet at the freeze
 * has no body to read and is counted as such (`noBody`), never as a read.
 */
function installFetchTap(): void {
	const w = window as unknown as PageGuard & { fetch: typeof fetch };
	interface OpenRead {
		done: Promise<void>;
		report: (aborted: boolean) => void;
	}
	const open = new Set<OpenRead>();
	const calls = new Set<Promise<unknown>>();
	/** `/api` fetches whose response headers have not arrived. */
	const waiting = new Set<object>();
	let started = 0;
	let reported = 0;
	const cut = (text: string) => text.slice(0, text.lastIndexOf("\n") + 1);
	const reportOpen = () => {
		for (const read of [...open]) read.report(true);
	};
	window.addEventListener("pagehide", reportOpen);
	w.__sealedGuardFlush = async (waitMs) => {
		// Let reads and responses on their way finish first; then report what
		// each open read has.
		await Promise.race([
			Promise.allSettled([...open].map((read) => read.done)),
			new Promise((resolve) => setTimeout(resolve, waitMs)),
		]);
		reportOpen();
		// Frozen here: no await between the last report and the counts.
		const counts = { started, reported, noBody: waiting.size };
		await Promise.allSettled([...calls]);
		return counts;
	};
	const original = w.fetch.bind(window);
	w.fetch = async (input, init) => {
		const ticket = {};
		try {
			const target = new URL(
				input instanceof Request ? input.url : String(input),
				location.href,
			);
			if (target.pathname.startsWith("/api/")) waiting.add(ticket);
		} catch {
			// Not a URL the tap understands: nothing to account for.
		}
		let response: globalThis.Response;
		try {
			response = await original(input, init);
		} catch (error) {
			waiting.delete(ticket);
			throw error;
		}
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
			const [forApp, forGuard] = response.body.tee();
			const decoder = new TextDecoder();
			let text = "";
			let finished = false;
			let finish: () => void = () => undefined;
			const done = new Promise<void>((resolve) => {
				finish = resolve;
			});
			const read: OpenRead = {
				done,
				report: (aborted) => {
					if (finished) return;
					finished = true;
					open.delete(read);
					text += decoder.decode();
					const call = w.__sealedGuard?.({
						...seen,
						text: aborted ? cut(text) : text,
					});
					if (call) {
						reported++;
						calls.add(call);
						void call.finally(() => calls.delete(call));
					}
					finish();
				},
			};
			open.add(read);
			started++;
			void (async () => {
				const reader = forGuard.getReader();
				try {
					for (;;) {
						const chunk = await reader.read();
						if (chunk.done) return read.report(false);
						text += decoder.decode(chunk.value, { stream: true });
					}
				} catch {
					// Aborted by the app's own signal, or the page is going away.
					read.report(true);
				}
			})();
			const tapped = new Response(forApp, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers,
			});
			Object.defineProperty(tapped, "url", { value: response.url });
			return tapped;
		} catch {
			// Never let the tap break the app's own request.
			return response;
		} finally {
			// After the read is open (or was not needed), in the same step.
			waiting.delete(ticket);
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

/**
 * Asks each open page to report the reads still open, and fails the test when
 * a page that answered started a read it never reported. A page the test
 * already closed is not asked: whatever it had read went out when it closed
 * (the tap reports on pagehide). Every wait is bounded, so a busy page cannot
 * hold the test's teardown.
 */
async function flushTaps(): Promise<void> {
	for (const context of tapped)
		for (const page of context.pages()) {
			if (page.isClosed()) continue;
			const result = (await within(
				3500,
				page
					.evaluate(
						(waitMs) =>
							(window as unknown as PageGuard).__sealedGuardFlush?.(waitMs),
						1500,
					)
					// The page navigated or closed while it answered.
					.catch(() => undefined),
			)) as { started: number; reported: number; noBody: number } | undefined;
			if (result) guardStats.noBody += result.noBody;
			if (result && result.started > result.reported)
				unreadable.push(
					`${result.started - result.reported} page read(s) started and never reported`,
				);
		}
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
