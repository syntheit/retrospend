import {
	expect,
	type Page,
	type Request,
	type Response,
} from "@playwright/test";
import { ADMIN_USER, TEST_USER } from "../constants";
import { gotoReady, waitUntilReady } from "./navigation";

export async function loginAs(
	page: Page,
	email: string,
	password: string,
): Promise<void> {
	// A submit before hydration would post the form natively, so wait first.
	await gotoReady(page, "/login");
	const sync = watchLocaleSync(page);
	try {
		await page.fill("#email", email);
		await page.fill("#password", password);
		await page.click('button[type="submit"]');
		await page.waitForURL(/\/home/);
		await waitUntilReady(page);
		await sync.settled();
	} finally {
		sync.stop();
	}
}

/**
 * A browser without a locale cookie gets one on its first dashboard page
 * (LocaleSync: a server action, then a full reload). The reload is part of
 * signing in, and it can land well after Home first looks quiet, so Home is
 * settled only once the action has answered and, when it set the cookie, the
 * reloaded document has loaded. The action can also be refused (a language
 * the cookie cannot hold), which sets nothing and reloads nothing.
 */
function watchLocaleSync(page: Page) {
	let answered = false;
	let reloadRequested = false;
	let reloadLoaded = false;
	// The reload can cancel the action's own "finished" event, so count the
	// answer (its headers, and with them the cookie) instead.
	const onResponse = (response: Response) => {
		if (response.request().headers()["next-action"] !== undefined)
			answered = true;
	};
	// The reload is the first document asked for after the answer. Home's own
	// load event is no use here: the reload can start before it fires.
	const onRequest = (request: Request) => {
		if (
			answered &&
			request.isNavigationRequest() &&
			request.frame() === page.mainFrame()
		)
			reloadRequested = true;
	};
	const onLoad = () => {
		if (reloadRequested) reloadLoaded = true;
	};
	page.on("response", onResponse);
	page.on("request", onRequest);
	page.on("load", onLoad);

	const hasLocaleCookie = async () =>
		(await page.context().cookies()).some((c) => c.name === "locale");
	const hadCookie = hasLocaleCookie();

	return {
		async settled() {
			if (await hadCookie) return;
			const timeout = { timeout: 15_000 };
			await expect.poll(() => answered, timeout).toBe(true);
			if (!(await hasLocaleCookie())) return;
			await expect.poll(() => reloadRequested, timeout).toBe(true);
			await expect.poll(() => reloadLoaded, timeout).toBe(true);
			await waitUntilReady(page);
		},
		stop() {
			page.off("response", onResponse);
			page.off("request", onRequest);
			page.off("load", onLoad);
		},
	};
}

export async function loginAsTestUser(page: Page): Promise<void> {
	await loginAs(page, TEST_USER.email, TEST_USER.password);
}

export async function loginAsAdmin(page: Page): Promise<void> {
	await loginAs(page, ADMIN_USER.email, ADMIN_USER.password);
}
