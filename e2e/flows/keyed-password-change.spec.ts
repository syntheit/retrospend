import { E2E_BASE_URL } from "../constants";
import { KEYED_ROTATE_USER as USER } from "../fixtures/keyed-user";
import { expect, type Page, test } from "../fixtures/sealed-guard";
import { gotoReady, waitUntilReady } from "../helpers/navigation";

// An account with Advanced protection keys changes its password in the same
// sheet as any account: the browser derives the old and the new sign-in secret
// and rewraps the account key, and the server only sees those. Afterwards the
// new password signs in and the old one does not.
test.use({ storageState: { cookies: [], origins: [] } });

async function signInAs(page: Page, password: string) {
	await gotoReady(page, "/login");
	await page.fill("#email", USER.email);
	await page.fill("#password", password);
	await page.click('button[type="submit"]');
}

test("a keyed account changes its password, signs in with the new one and not the old", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const sent: string[] = [];
	page.on("request", (req) => {
		if (req.url().includes("/api/v1/me/protection/password"))
			sent.push(`${req.method()} ${req.url()} ${req.postData() ?? ""}`);
	});

	await signInAs(page, USER.password);
	await page.waitForURL(/\/home/);
	await waitUntilReady(page);

	await gotoReady(page, "/settings");
	await page.getByRole("button", { name: "Change password" }).click();
	const sheet = page.getByRole("dialog");
	await sheet.getByLabel("Current password").fill(USER.password);
	await sheet
		.getByLabel("New password", { exact: true })
		.fill(USER.newPassword);
	await sheet.getByLabel("Confirm new password").fill(USER.newPassword);
	await sheet.getByRole("button", { name: "Update password" }).click();
	await expect(page.getByText(/Password changed/)).toBeVisible({
		timeout: 90_000,
	});

	// Begin and commit, with derived secrets only.
	expect(sent.map((s) => s.split(" ")[1]?.replace(/^.*\/api/, "/api"))).toEqual(
		["/api/v1/me/protection/password/begin", "/api/v1/me/protection/password"],
	);
	for (const call of sent) {
		expect(call).not.toContain(USER.password);
		expect(call).not.toContain(USER.newPassword);
	}

	// Sign out, then the old password is refused and the new one signs in.
	await page.request.post("/api/auth/sign-out", {
		headers: { Origin: E2E_BASE_URL },
		data: {},
	});
	await page.context().clearCookies();

	await signInAs(page, USER.password);
	await expect(page.getByRole("alert")).toBeVisible({ timeout: 90_000 });
	await expect(page).toHaveURL(/\/login/);

	await signInAs(page, USER.newPassword);
	await page.waitForURL(/\/home/, { timeout: 90_000 });
});
