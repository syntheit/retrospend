import { encodeRecoveryKey } from "../../packages/crypto/src/keys";
import { E2E_BASE_URL } from "../constants";
import {
	KEYED_RECOVERY_KEY_TEXT,
	KEYED_RECOVER_USER as USER,
} from "../fixtures/keyed-user";
import { issueResetLink } from "../fixtures/reset-link";
import {
	expect,
	type Locator,
	type Page,
	test,
} from "../fixtures/sealed-guard";
import { gotoReady, waitUntilReady } from "../helpers/navigation";

// A keyed account that forgot its password opens the reset link, uses its
// recovery key and sets a new password. The key is read in nine boxes (a paste
// fills them all), checked by the server before the new password is asked for,
// and the new password is made into keys in the browser: the server only ever
// sees the proof and the wraps. Afterwards the new password signs in, the old
// one does not, and the link is spent.
test.use({ storageState: { cookies: [], origins: [] } });
// The recovery commits, so a retry on the same database would run on a spent
// link and a password that changed, and hide the real failure.
test.describe.configure({ retries: 0 });

const RECOVERY = "/api/v1/auth/recovery";

/** What a paste of `text` into one box does: the page reads it from the event. */
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

async function signInAs(page: Page, password: string) {
	await gotoReady(page, "/login");
	await page.fill("#email", USER.email);
	await page.fill("#password", password);
	await page.click('button[type="submit"]');
}

test("a keyed account recovers with its recovery key, signs in with the new password and not the old, and the link is spent", async ({
	page,
}) => {
	test.setTimeout(240_000);
	const sent: { url: string; body: string }[] = [];
	page.on("request", (req) => {
		if (req.url().includes(RECOVERY))
			sent.push({
				url: req.url().replace(/^.*\/api/, "/api"),
				body: req.postData() ?? "",
			});
	});
	const token = await issueResetLink(USER.email);

	await gotoReady(page, `/auth/reset-password?token=${token}`);
	// The link leads to the choices: the account has keys, protection is off.
	await expect(
		page.getByRole("heading", { name: "Reset your password" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Use key" }).click();

	const sheet = page.getByRole("dialog");
	await expect(sheet.getByLabel(/^Group \d$/)).toHaveCount(9);
	const first = sheet.getByLabel("Group 1", { exact: true });
	const continueButton = sheet.getByRole("button", { name: "Continue" });
	await expect(continueButton).toBeDisabled();

	// A typo (one symbol changed) is refused on the page, and nothing is asked.
	const wrongSymbol = KEYED_RECOVERY_KEY_TEXT.startsWith("0") ? "1" : "0";
	await pasteInto(first, wrongSymbol + KEYED_RECOVERY_KEY_TEXT.slice(1));
	await expect(continueButton).toBeEnabled();
	await continueButton.click();
	await expect(sheet.getByText("Check the key for a typo.")).toBeVisible();
	expect(sent).toHaveLength(0);

	// A key of another account: the server refuses the proof.
	const other = encodeRecoveryKey(Uint8Array.from({ length: 32 }, (_, i) => i));
	await pasteInto(first, other);
	await continueButton.click();
	await expect(
		sheet.getByText("That is not this account's recovery key."),
	).toBeVisible();
	expect(sent.map((c) => c.url)).toEqual([`${RECOVERY}/begin`]);

	// The right key, pasted whole into the middle box, fills all nine.
	await pasteInto(
		sheet.getByLabel("Group 5", { exact: true }),
		KEYED_RECOVERY_KEY_TEXT,
	);
	const groups = KEYED_RECOVERY_KEY_TEXT.split("-");
	for (const [i, group] of groups.entries())
		await expect(
			sheet.getByLabel(`Group ${i + 1}`, { exact: true }),
		).toHaveValue(group);
	await continueButton.click();

	// The key is proven before a new password is asked for.
	await expect(
		sheet.getByRole("heading", { name: "Set a new password" }),
	).toBeVisible();
	expect(sent.map((c) => c.url)).toEqual([
		`${RECOVERY}/begin`,
		`${RECOVERY}/begin`,
	]);
	await sheet
		.getByLabel("New password", { exact: true })
		.fill(USER.newPassword);
	await sheet.getByLabel("Confirm new password").fill(USER.newPassword);
	await sheet.getByRole("button", { name: "Set password" }).click();
	await expect(page.getByText("Password updated successfully!")).toBeVisible({
		timeout: 90_000,
	});
	await page.waitForURL(/\/login/);

	// Begin twice, then one commit; the password and the key text never go.
	expect(sent.map((c) => c.url)).toEqual([
		`${RECOVERY}/begin`,
		`${RECOVERY}/begin`,
		RECOVERY,
	]);
	for (const c of sent) {
		expect(c.body).toContain(token);
		expect(c.body).not.toContain(USER.newPassword);
		expect(c.body).not.toContain(USER.password);
		expect(c.body).not.toContain(KEYED_RECOVERY_KEY_TEXT);
		expect(c.body).not.toContain(groups.join(""));
	}
	const commit = JSON.parse(sent[2]?.body ?? "{}") as Record<string, unknown>;
	expect(Object.keys(commit).sort()).toEqual([
		"baseVersion",
		"kdf",
		"newAuthKey",
		"recoveryAuthKey",
		"token",
		"wrappedAccountKey",
	]);

	// The old password is refused and the new one signs in.
	await signInAs(page, USER.password);
	await expect(page.getByText("Invalid email or password")).toBeVisible({
		timeout: 90_000,
	});
	await signInAs(page, USER.newPassword);
	await page.waitForURL(/\/home/, { timeout: 90_000 });
	await waitUntilReady(page);

	// The link works once: it is spent now.
	await page.request.post("/api/auth/sign-out", {
		headers: { Origin: E2E_BASE_URL },
		data: {},
	});
	await page.context().clearCookies();
	await gotoReady(page, `/auth/reset-password?token=${token}`);
	await expect(
		page.getByRole("heading", { name: "Invalid link" }),
	).toBeVisible();
	await expect(
		page.getByText("This link has expired or was already used."),
	).toBeVisible();
});
