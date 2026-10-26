import { expect, test } from "@playwright/test";
import { E2E_BASE_URL } from "../constants";

// The routes of the old UI answer a permanent redirect to the new page, with
// the query string kept. The redirect comes before the sign-in check, so no
// session is needed.

test.use({ storageState: { cookies: [], origins: [] } });

const MOVED: [from: string, to: string][] = [
	["/dashboard", "/home"],
	["/transactions", "/activity"],
	["/recurring", "/activity/recurring"],
];

for (const [from, to] of MOVED) {
	test(`${from} answers 308 to ${to} and keeps the query`, async ({
		request,
	}) => {
		const res = await request.get(`${from}?x=1&y=two`, { maxRedirects: 0 });
		expect(res.status()).toBe(308);
		const location = new URL(res.headers().location ?? "", E2E_BASE_URL);
		expect(location.pathname).toBe(to);
		expect(location.search).toBe("?x=1&y=two");
	});
}
