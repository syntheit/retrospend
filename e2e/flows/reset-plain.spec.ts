import { PLAIN_RESET_USER as USER } from "../fixtures/enable-user";
import { issueResetLink } from "../fixtures/keyed-user";
import { expect, test } from "../fixtures/sealed-guard";
import { gotoReady, waitUntilReady } from "../helpers/navigation";

// The reset page asks the recovery check about the link first. That check does
// not know an admin's link (it never opens recovery), so the page must not call
// it dead: it shows the plain form, and the server judges the token when the
// form is sent, as it always did.
test.use({ storageState: { cookies: [], origins: [] } });
// The reset commits, so a retry would run on a spent link and a changed password.
test.describe.configure({ retries: 0 });

test("an admin's reset link sets a new password through the page for an account without keys", async ({
	page,
}) => {
	test.setTimeout(120_000);
	const token = await issueResetLink(USER.email, "admin");
	await gotoReady(page, `/auth/reset-password?token=${token}`);
	await expect(
		page.getByRole("heading", { name: "Set new password" }),
	).toBeVisible();
	await expect(page.getByRole("heading", { name: "Invalid link" })).toHaveCount(
		0,
	);
	await page.getByLabel("New password", { exact: true }).fill(USER.newPassword);
	await page.getByLabel("Confirm password").fill(USER.newPassword);
	await page.getByRole("button", { name: "Confirm and save" }).click();
	await page.waitForURL(/\/login/);

	await page.fill("#email", USER.email);
	await page.fill("#password", USER.newPassword);
	await page.click('button[type="submit"]');
	await page.waitForURL(/\/home/, { timeout: 90_000 });
	await waitUntilReady(page);
});

test("a link no check knows still shows the form, and the server refuses it when it is sent", async ({
	page,
}) => {
	await gotoReady(page, "/auth/reset-password?token=not-a-real-token");
	await expect(
		page.getByRole("heading", { name: "Set new password" }),
	).toBeVisible();
	await page
		.getByLabel("New password", { exact: true })
		.fill("Whatever-pass-2027?");
	await page.getByLabel("Confirm password").fill("Whatever-pass-2027?");
	await page.getByRole("button", { name: "Confirm and save" }).click();
	await expect(page.getByText("Invalid or expired token")).toBeVisible();
	await expect(page).toHaveURL(/auth\/reset-password/);
});
