import {
	issueResetLink,
	KEYED_RECOVERY_KEY_TEXT as OLD_KEY,
	KEYED_NEWKEY_USER as USER,
} from "../fixtures/keyed-user";
import { expect, type Locator, test } from "../fixtures/sealed-guard";
import { gotoReady, waitUntilReady } from "../helpers/navigation";

// A keyed account makes a new recovery key from Settings: its password, the new
// key shown and two groups typed back, then saved. The key is made in the
// browser and read back from the server before the toast. Afterwards the old
// key no longer recovers the account and the new one does.
test.use({ storageState: { cookies: [], origins: [] } });
// The save replaces the stored key, so a retry would find a different account
// than the one the flow made.
test.describe.configure({ retries: 0 });

const PROTECTION = "/api/v1/me/protection/";
const OPEN = "/api/v1/me/protection/keys/open";
const COMMIT = "/api/v1/me/protection/recovery-key";

async function pasteInto(box: Locator, text: string) {
	await box.evaluate((el, value) => {
		const data = new DataTransfer();
		data.setData("text/plain", value);
		el.dispatchEvent(
			new ClipboardEvent("paste", {
				clipboardData: data,
				bubbles: true,
				cancelable: true,
			}),
		);
	}, text);
}

test("a keyed account makes a new recovery key: the old one stops recovering, the new one recovers", async ({
	page,
}) => {
	test.setTimeout(240_000);
	const sent: { method: string; url: string; body: string; key: string }[] = [];
	page.on("request", (req) => {
		if (req.url().includes(PROTECTION))
			sent.push({
				method: req.method(),
				url: req.url().replace(/^.*\/api/, "/api"),
				body: req.postData() ?? "",
				key: req.headers()["idempotency-key"] ?? "",
			});
	});

	await gotoReady(page, "/login");
	await page.fill("#email", USER.email);
	await page.fill("#password", USER.password);
	await page.click('button[type="submit"]');
	await page.waitForURL(/\/home/, { timeout: 90_000 });
	await waitUntilReady(page);

	await gotoReady(page, "/settings");
	const row = page
		.getByRole("listitem")
		.filter({ hasText: "Advanced protection" });
	await expect(row.getByText("Keys ready")).toBeVisible();
	await row.getByRole("button", { name: "Make new key" }).click();

	const sheet = page.getByRole("dialog");
	const proceed = sheet.getByRole("button", { name: "Continue" });
	await expect(proceed).toBeDisabled();
	// A wrong password is a line on this step, and no key is made.
	await sheet.getByLabel("Password", { exact: true }).fill("not the password");
	await proceed.click();
	await expect(sheet.getByText("Wrong password")).toBeVisible({
		timeout: 90_000,
	});
	await sheet.getByLabel("Password", { exact: true }).fill(USER.password);
	await proceed.click();

	// The key is made (a busy moment), shown in nine groups, and confirmed.
	await expect(
		sheet.getByRole("heading", { name: "Save your recovery key" }),
	).toBeVisible({ timeout: 90_000 });
	const groups = await sheet.locator("fieldset .font-mono").allInnerTexts();
	expect(groups).toHaveLength(9);
	const newKey = groups.join("-");
	expect(newKey).not.toBe(OLD_KEY);
	await sheet.getByRole("button", { name: "I saved it" }).click();
	for (const label of await sheet.getByText(/^Group \d$/).allInnerTexts()) {
		const n = Number(label.replace("Group ", ""));
		await sheet.getByLabel(label, { exact: true }).fill(groups[n - 1] ?? "");
	}
	// Nothing is committed before this button: the old key still works until then.
	expect(sent.some((c) => c.url === COMMIT)).toBe(false);
	await sheet.getByRole("button", { name: "Save key" }).click();
	await expect(page.getByText("New recovery key saved")).toBeVisible({
		timeout: 90_000,
	});
	await expect(sheet).toBeHidden();

	// The wrong password and the right one each open the keys, then the commit
	// under an Idempotency-Key, then the read-back; no password, no key text.
	const posts = sent.filter((c) => c.method === "POST");
	expect(posts.map((c) => c.url)).toEqual([OPEN, OPEN, COMMIT, OPEN]);
	const commit = sent.find((c) => c.url === COMMIT);
	expect(commit?.key).not.toBe("");
	expect(Object.keys(JSON.parse(commit?.body ?? "{}")).sort()).toEqual([
		"baseVersion",
		"currentAuthKey",
		"recoveryAuthKey",
		"wrappedRecoveryKey",
	]);
	for (const c of sent) {
		expect(c.body).not.toContain(USER.password);
		expect(c.body).not.toContain(newKey);
		expect(c.body).not.toContain(groups.join(""));
	}

	// The old key no longer recovers the account; the new one does.
	await page.context().clearCookies();
	const token = await issueResetLink(USER.email);
	await gotoReady(page, `/auth/reset-password?token=${token}`);
	await page.getByRole("button", { name: "Use key" }).click();
	const recover = page.getByRole("dialog");
	const first = recover.getByLabel("Group 1", { exact: true });
	await pasteInto(first, OLD_KEY);
	await recover.getByRole("button", { name: "Continue" }).click();
	await expect(
		recover.getByText("That is not this account's recovery key."),
	).toBeVisible();
	await pasteInto(first, newKey);
	await recover.getByRole("button", { name: "Continue" }).click();
	await expect(
		recover.getByRole("heading", { name: "Set a new password" }),
	).toBeVisible();
	// Cancelling here ends the recovery without a new password.
	await recover.getByRole("button", { name: "Cancel" }).click();
	await expect(recover).toBeHidden();
});
