import { E2E_BASE_URL } from "../constants";
import { ENABLE_USER as USER } from "../fixtures/enable-user";
import { expect, type Page, test } from "../fixtures/sealed-guard";
import { gotoReady, waitUntilReady } from "../helpers/navigation";

// A plain account turns Advanced protection on from Settings: a new password,
// the recovery key saved and confirmed, then its current password. The keys are
// made in the browser and read back from the server before the sheet says done.
// Afterwards the account holds keys (and stays off: nothing is sealed), the new
// password signs in and the old one does not.
test.use({ storageState: { cookies: [], origins: [] } });
// The enable commits, so a retry on the same database would sign in with a
// password that no longer exists and hide the real failure.
test.describe.configure({ retries: 0 });

async function signInAs(page: Page, password: string) {
	await gotoReady(page, "/login");
	await page.fill("#email", USER.email);
	await page.fill("#password", password);
	await page.click('button[type="submit"]');
}

test("a plain account turns Advanced protection on, and signs in with the new password only", async ({
	page,
}) => {
	test.setTimeout(240_000);
	const sent: { url: string; body: string }[] = [];
	page.on("request", (req) => {
		if (req.url().includes("/api/v1/me/protection/"))
			sent.push({
				url: req.url().replace(/^.*\/api/, "/api"),
				body: req.postData() ?? "",
			});
	});

	await signInAs(page, USER.password);
	await page.waitForURL(/\/home/);
	await waitUntilReady(page);

	await gotoReady(page, "/settings");
	const row = page.getByRole("listitem").filter({ hasText: "Advanced protection" });
	await expect(row.getByText("Off", { exact: true })).toBeVisible();
	await row.getByRole("button", { name: "Turn on" }).click();

	const sheet = page.getByRole("dialog");
	await sheet.getByRole("button", { name: "Continue" }).click();
	await sheet.getByLabel("New password", { exact: true }).fill(USER.newPassword);
	await sheet.getByLabel("Confirm new password").fill(USER.newPassword);
	await sheet.getByRole("button", { name: "Continue" }).click();

	// The keys are made (a busy moment), then the key is created, shown and confirmed.
	await sheet.getByRole("button", { name: "Create key" }).click({ timeout: 90_000 });
	const groups = await sheet.locator("fieldset .font-mono").allInnerTexts();
	expect(groups).toHaveLength(9);
	await sheet.getByRole("button", { name: "I saved it" }).click();
	for (const label of await sheet.getByText(/^Group \d$/).allInnerTexts()) {
		const n = Number(label.replace("Group ", ""));
		await sheet.getByLabel(label, { exact: true }).fill(groups[n - 1] ?? "");
	}
	await sheet.getByRole("button", { name: "Continue" }).click();
	await expect(sheet.getByText("Done", { exact: true })).toBeVisible();
	await sheet.getByRole("button", { name: "Continue" }).click();

	await sheet.getByLabel("Password", { exact: true }).fill(USER.password);
	await sheet.getByRole("button", { name: "Save keys" }).click();
	await expect(sheet.getByText(/Your keys are ready/)).toBeVisible({
		timeout: 90_000,
	});
	await sheet.getByRole("button", { name: "Done" }).click();
	await expect(page.getByText("Keys saved")).toBeVisible();
	await expect(row.getByText("Keys ready")).toBeVisible();

	// Enable, then the read-back with the new sign-in secret. The old password
	// goes once, as the proof; the new password and the recovery key never go.
	const calls = sent.filter((c) => c.url.endsWith("/enable") || c.url.endsWith("/keys/open"));
	expect(calls.map((c) => c.url)).toEqual([
		"/api/v1/me/protection/enable",
		"/api/v1/me/protection/keys/open",
	]);
	const [enable, open] = calls.map((c) => JSON.parse(c.body) as Record<string, unknown>);
	expect(enable?.currentPassword).toBe(USER.password);
	expect(open).toEqual({ authKey: enable?.authKey });
	for (const c of sent) {
		expect(c.body).not.toContain(USER.newPassword);
		expect(c.body).not.toContain(groups.join("-"));
	}

	// The server holds the keys, and prelogin now names the account's salt.
	expect((await page.request.get("/api/v1/me/protection/keys")).status()).toBe(200);
	const prelogin = await page.request.post("/api/v1/auth/prelogin", {
		data: { email: USER.email },
	});
	expect((await prelogin.json()).kdf).not.toBeNull();

	// Sign out: the old password is refused and the new one signs in.
	await page.request.post("/api/auth/sign-out", {
		headers: { Origin: E2E_BASE_URL },
		data: {},
	});
	await page.context().clearCookies();
	await signInAs(page, USER.password);
	await expect(page.getByText("Invalid email or password")).toBeVisible({
		timeout: 90_000,
	});
	await signInAs(page, USER.newPassword);
	await page.waitForURL(/\/home/, { timeout: 90_000 });
});
