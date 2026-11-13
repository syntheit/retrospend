/**
 * The e2e `test`, with one addition for sealed runs (E2E_SEALED=1, E2EE D11
 * PR 9.2): any `/api` JSON response that holds a string starting with U+0001
 * fails the test. A sealed value must never leave the server (design section
 * 7.1), and the server's own response guard runs only under NODE_ENV=test,
 * not in `next dev`, so the browser side checks every response here.
 *
 * It watches the browser contexts (pages), `page.request` and `context.request`,
 * the `request` fixture, and contexts a test opens itself with
 * `browser.newContext`, and request contexts made with
 * `playwright.request.newContext` (the API-token specs).
 *
 * A failure names the method, the path and the JSON path of the string, never
 * its value. Unsealed runs pass everything through untouched.
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
import { sealedPaths } from "../helpers/sealed-paths";

export * from "@playwright/test";

// One worker runs one test at a time, so module state is the current test's.
const leaks: string[] = [];
const pending = new Set<Promise<void>>();

function inspect(
	method: string,
	url: string,
	contentType: string | undefined,
	body: () => Promise<unknown>,
): void {
	const { pathname } = new URL(url);
	if (!pathname.startsWith("/api/") || !contentType?.includes("json")) return;
	const job = body().then(
		(json) => {
			for (const at of sealedPaths(json))
				leaks.push(`${method} ${pathname} ${at}`);
		},
		// No body to read (a redirect, a closed page): nothing to check.
		() => undefined,
	);
	pending.add(job);
	void job.finally(() => pending.delete(job));
}

const inspectResponse = (response: Response): void =>
	inspect(
		response.request().method(),
		response.url(),
		response.headers()["content-type"],
		() => response.json(),
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
					prop.toUpperCase(),
					response.url(),
					response.headers()["content-type"],
					() => response.json(),
				);
				return response;
			};
		},
	});
}

const watched = new WeakSet<BrowserContext>();

function watch(context: BrowserContext): BrowserContext {
	if (watched.has(context)) return context;
	watched.add(context);
	context.on("response", inspectResponse);
	Object.defineProperty(context, "request", {
		value: guardRequest(context.request),
	});
	return context;
}

/** A browser whose own contexts and pages are watched too. */
function guardBrowser(browser: Browser): Browser {
	const newContext = browser.newContext.bind(browser);
	const newPage = browser.newPage.bind(browser);
	browser.newContext = async (options) => watch(await newContext(options));
	browser.newPage = async (options) => {
		const page = await newPage(options);
		watch(page.context());
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
		await use(E2E_SEALED ? watch(context) : context);
	},
	request: async ({ request }, use) => {
		await use(E2E_SEALED ? guardRequest(request) : request);
	},
	sealedGuard: [
		// Playwright wants a destructured first argument; browserName costs nothing.
		async ({ browserName }, use) => {
			void browserName;
			leaks.length = 0;
			await use();
			if (!E2E_SEALED) return;
			await Promise.all(pending);
			if (leaks.length > 0)
				throw new Error(
					`A sealed value (U+0001) left the server in ${leaks.length} response(s): ${[...new Set(leaks)].join("; ")}`,
				);
		},
		{ auto: true },
	],
});
