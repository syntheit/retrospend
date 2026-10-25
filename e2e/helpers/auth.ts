import type { Page } from "@playwright/test";
import { ADMIN_USER, TEST_USER } from "../constants";
import { gotoReady, waitUntilReady } from "./navigation";

export async function loginAs(
	page: Page,
	email: string,
	password: string,
): Promise<void> {
	// A submit before hydration would post the form natively, so wait first.
	await gotoReady(page, "/login");
	await page.fill("#email", email);
	await page.fill("#password", password);
	await page.click('button[type="submit"]');
	await page.waitForURL(/\/home/);
	await waitUntilReady(page);
}

export async function loginAsTestUser(page: Page): Promise<void> {
	await loginAs(page, TEST_USER.email, TEST_USER.password);
}

export async function loginAsAdmin(page: Page): Promise<void> {
	await loginAs(page, ADMIN_USER.email, ADMIN_USER.password);
}
