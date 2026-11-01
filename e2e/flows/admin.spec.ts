import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE } from "../constants";
import { bannedOutputOn } from "../helpers/banned-output";
import { gotoReady } from "../helpers/navigation";

// The admin page: figures at the top, then one tab per section.
test.use({ storageState: ADMIN_STORAGE_STATE });

test.describe("Admin", () => {
	test("reads at a glance and moves between sections by tab", async ({
		page,
	}) => {
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await gotoReady(page, "/admin");

		const main = page.getByRole("main");
		const figures = main.locator('[data-slot="admin-figures"]');
		for (const label of [
			"Users",
			"Active this week",
			"Expenses this month",
			"Storage",
			"Server version",
			"Unread feedback",
			"Error reports",
			"Invites used",
		])
			await expect(figures.getByText(label, { exact: true })).toBeVisible();

		const tabs = main.getByRole("tablist", { name: "Admin sections" });
		for (const name of [
			"Users",
			"Participants",
			"Invite codes",
			"Feedback",
			"AI usage",
			"Server",
			"Settings",
			"Audit logs",
		])
			await expect(tabs.getByRole("tab", { name })).toBeVisible();

		// The tab row sits within the first screen, with its section under it.
		const row = await tabs.boundingBox();
		expect(row?.y ?? 9999).toBeLessThan(450);

		await tabs.getByRole("tab", { name: "Settings" }).click();
		await expect(page).toHaveURL(/#settings$/);
		await expect(main.getByText("Require invite codes")).toBeVisible();

		await tabs.getByRole("tab", { name: "Server" }).click();
		await expect(main.getByText("Sidecar")).toBeVisible();

		// A link with a hash lands on its tab.
		await gotoReady(page, "/profile");
		await gotoReady(page, "/admin#invite-codes");
		await expect(tabs.getByRole("tab", { name: "Invite codes" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		expect(await bannedOutputOn(page), "banned output").toEqual([]);
	});
});
