import { E2E_BASE_URL, TEST_USER } from "../constants";
import {
	KEYED_KDF,
	KEYED_USER,
	keyedSignInSecret,
} from "../fixtures/keyed-user";
import { expect, test } from "../fixtures/sealed-guard";
import { gotoReady, waitUntilReady } from "../helpers/navigation";

// An account with Advanced protection keys signs in with a key made from its
// password in the browser (prelogin, Argon2id), never with the password. The
// plain accounts sign in through the same form with what they type (every
// persona's saved session in auth.setup.ts does).
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("sign in with protection keys", () => {
	test("prelogin names the keyed account's salt and the plain account has none", async ({
		request,
	}) => {
		const ask = async (email: string) =>
			(
				await (
					await request.post("/api/v1/auth/prelogin", { data: { email } })
				).json()
			).kdf;
		expect(await ask(KEYED_USER.email)).toEqual(KEYED_KDF);
		expect(await ask(TEST_USER.email)).toBeNull();
		expect(await ask("nobody@nowhere.example")).toBeNull();
	});

	test("the form signs a keyed account in and sends the derived secret, not the password", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const secret = await keyedSignInSecret();
		let sent: string | undefined;
		page.on("request", (req) => {
			if (req.url().endsWith("/api/auth/sign-in/email"))
				sent = (req.postDataJSON() as { password: string }).password;
		});

		await gotoReady(page, "/login");
		await page.fill("#email", KEYED_USER.email);
		await page.fill("#password", KEYED_USER.password);
		await page.click('button[type="submit"]');
		await page.waitForURL(/\/home/);
		await waitUntilReady(page);

		expect(sent).toBe(secret);
		expect(sent).not.toBe(KEYED_USER.password);
		expect(secret).toHaveLength(43);
	});

	test("the server refuses the typed password of a keyed account", async ({
		request,
	}) => {
		const res = await request.post("/api/auth/sign-in/email", {
			headers: { Origin: E2E_BASE_URL },
			data: { email: KEYED_USER.email, password: KEYED_USER.password },
		});
		expect(res.ok()).toBe(false);
	});
});
