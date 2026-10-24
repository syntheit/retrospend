import { expect, type Page, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE, USER_STORAGE_STATE } from "../../constants";
import { bannedOutputOn } from "../../helpers/banned-output";
import { setEnvelopeBudgetMode } from "../../helpers/envelope-flag";
import { gotoReady } from "../../helpers/navigation";
import { untilSaved } from "../../helpers/trpc";
import { trpcMutation } from "./entry-audit";

// The Budget sheets (4C2) on the blank test user's own envelope book, opened
// from the dev harness (/dev/budget-sheets) until the Budget page opens them.
// Every money sheet shows the server's dry run before Save, and Save ends
// with an Undo toast that calls the server undo. The book (USD) starts with
// 1,500.00 to assign, a Groceries target of 400.00 and 120.00 spent in
// Everything else, so Everything else is overspent by 120.00.

test.use({ storageState: USER_STORAGE_STATE });
test.describe.configure({ mode: "serial" });

const today = () =>
	new Date().toLocaleDateString("en-CA", {
		timeZone: "America/Argentina/Buenos_Aires",
	});

test.beforeAll(async ({ browser }) => {
	const admin = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
	await setEnvelopeBudgetMode(admin.request, "ALL");
	await admin.close();
});

test.afterAll(async ({ browser }) => {
	const admin = await browser.newContext({ storageState: ADMIN_STORAGE_STATE });
	await setEnvelopeBudgetMode(admin.request, "OFF");
	await admin.close();
});

test("the book: set up, with an overspent envelope", async ({ page }) => {
	test.setTimeout(180_000);
	await gotoReady(page, "/dev/budget-sheets");
	const due = new Date();
	due.setMonth(due.getMonth() + 1, 5);
	await trpcMutation(page, "envelope.setup", {
		style: "FLEX",
		currency: "USD",
		startingMoneyMinor: 150000,
		groups: [
			{ key: "bills", name: "Bills", role: "BILLS" },
			{ key: "spending", name: "Spending", role: "SPENDING" },
			{ key: "savings", name: "Savings", role: "SAVINGS" },
		],
		envelopes: [
			{
				key: "rent",
				name: "Rent",
				groupKey: "bills",
				kind: "BILL",
				target: {
					kind: "BILL",
					amountMinor: 60000,
					dueDate: due.toISOString().slice(0, 10),
					repeat: "MONTHLY",
				},
			},
			{
				key: "food",
				name: "Groceries",
				groupKey: "spending",
				kind: "MONTHLY",
				target: { kind: "MONTHLY", amountMinor: 40000 },
			},
			{
				key: "rest",
				name: "Everything else",
				groupKey: "spending",
				kind: "MONTHLY",
				isDefault: true,
			},
			{
				key: "goal",
				name: "Emergency fund",
				groupKey: "savings",
				kind: "SAVINGS",
				target: { kind: "SAVINGS", amountMinor: 500000 },
			},
		],
	});
	const category = await trpcMutation<{ id: string }>(
		page,
		"categories.create",
		{ name: "E2E coffee", color: "teal" },
	);
	await trpcMutation(page, "entry.expense.create.save", {
		id: crypto.randomUUID(),
		title: "E2E coffee beans",
		amount: "120.00",
		currency: "USD",
		date: today(),
		categoryId: category.id,
	});
});

async function openSheet(page: Page, opener: string, title: RegExp | string) {
	await gotoReady(page, "/dev/budget-sheets");
	await page.locator(`[data-sheet-opener="${opener}"]`).click();
	const sheet = page.getByRole("dialog", { name: title });
	await expect(sheet).toBeVisible();
	return sheet;
}

const toast = (page: Page, text: string | RegExp) =>
	page.locator("[data-sonner-toast]").filter({ hasText: text });

test("Assign: clear, type, preview, save, undo", async ({ page }) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const sheet = await openSheet(page, "assign", /^Assign /);
	await sheet.getByRole("button", { name: "Clear" }).click();
	await sheet.getByRole("textbox", { name: "Assign to Groceries" }).fill("250");
	const changes = sheet.getByRole("region", { name: "What this changes" });
	await expect(changes.getByText("Groceries")).toBeVisible();
	await expect(changes).toContainText("USD 0.00");
	await expect(changes).toContainText("USD 250.00");
	expect(await bannedOutputOn(page), "banned output").toEqual([]);

	const save = sheet.getByRole("button", { name: "Assign", exact: true });
	await expect(save).toBeEnabled();
	await untilSaved(page, "envelope.assign", () => save.click());
	await expect(sheet).toBeHidden();
	await untilSaved(page, "envelope.undo", () =>
		toast(page, "Assigned").getByRole("button", { name: "Undo" }).click(),
	);
	await expect(toast(page, "Undone")).toBeVisible();
});

test("Move: from Not planned yet to Groceries, then out again", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await gotoReady(page, "/dev/budget-sheets");
	await page.getByRole("button", { name: "Move Groceries" }).click();
	const sheet = page.getByRole("dialog", { name: "Groceries" });
	await expect(sheet).toBeVisible();
	await sheet.getByRole("textbox", { name: "Amount" }).fill("75");
	const changes = sheet.getByRole("region", { name: "What this changes" });
	await expect(changes).toContainText("USD 75.00");
	await untilSaved(page, "envelope.assign", () =>
		sheet.getByRole("button", { name: "Move", exact: true }).click(),
	);
	await expect(sheet).toBeHidden();
	await untilSaved(page, "envelope.undo", () =>
		toast(page, "Moved").getByRole("button", { name: "Undo" }).click(),
	);
});

test("Cover: Everything else is over by 120.00; preview, save, undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await gotoReady(page, "/dev/budget-sheets");
	await page.getByRole("button", { name: "Cover Everything else" }).click();
	const sheet = page.getByRole("dialog", { name: "Cover Everything else" });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole("textbox", { name: "Amount" })).toHaveValue(
		"120",
	);
	const changes = sheet.getByRole("region", { name: "What this changes" });
	await expect(changes).toContainText("Everything else");
	await expect(changes).toContainText("USD 0.00");
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await untilSaved(page, "envelope.cover", () =>
		sheet.getByRole("button", { name: "Cover", exact: true }).click(),
	);
	await expect(sheet).toBeHidden();
	await untilSaved(page, "envelope.undo", () =>
		toast(page, "Covered").getByRole("button", { name: "Undo" }).click(),
	);
});

test("Cover all: every overspent envelope from Not planned yet, one Undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const sheet = await openSheet(page, "coverAll", "Cover overspending");
	await expect(sheet.getByText("Everything else").first()).toBeVisible();
	const changes = sheet.getByRole("region", { name: "What this changes" });
	await expect(changes).toContainText("USD 0.00");
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await untilSaved(page, "envelope.assign", () =>
		sheet.getByRole("button", { name: "Cover all" }).click(),
	);
	await expect(sheet).toBeHidden();
	await untilSaved(page, "envelope.undo", () =>
		toast(page, "Covered").getByRole("button", { name: "Undo" }).click(),
	);
});

test("Use my plan: lists the jobs, then writes one batch and undoes it", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const sheet = await openSheet(page, "usePlan", "Use my plan");
	await expect(sheet.getByText("these jobs")).toBeVisible();
	await expect(sheet.getByText("Groceries")).toBeVisible();
	const changes = sheet.getByRole("region", { name: "What this changes" });
	await expect(changes).toContainText("Groceries");
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await untilSaved(page, "envelope.assign", () =>
		sheet.getByRole("button", { name: "Use my plan", exact: true }).click(),
	);
	await expect(sheet).toBeHidden();
	await untilSaved(page, "envelope.undo", () =>
		toast(page, "Plan used").getByRole("button", { name: "Undo" }).click(),
	);
});

test("Rules: add a rule, see it in one sentence, remove it", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const sheet = await openSheet(page, "rules", "Income rules");
	await sheet.getByRole("button", { name: "Add rule" }).click();
	const editor = page.getByRole("dialog", { name: "Add rule" });
	await editor.getByRole("textbox", { name: "Name" }).fill("E2E save first");
	await editor.getByRole("textbox", { name: "Percent of money in" }).fill("20");
	await editor.getByRole("combobox", { name: "Goes to" }).click();
	await page.getByRole("option", { name: /Emergency fund/ }).click();
	await untilSaved(page, "envelope.createRule", () =>
		editor.getByRole("button", { name: "Add rule", exact: true }).click(),
	);
	await expect(
		sheet.getByText("20% of money in to Emergency fund"),
	).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await sheet.getByRole("button", { name: "More for E2E save first" }).click();
	await page.getByRole("menuitem", { name: "Remove" }).click();
	await untilSaved(page, "envelope.archiveRule", () =>
		page.getByRole("button", { name: "Remove rule" }).click(),
	);
	await expect(sheet.getByText("No rules yet")).toBeVisible();
});

test("Style: Flex to Limits shows the preview, saves, and Undo switches back", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const sheet = await openSheet(page, "style", "Budget style");
	await sheet.getByRole("combobox", { name: "Style" }).click();
	await page.getByRole("option", { name: "Limits" }).click();
	await expect(
		sheet.getByRole("region", { name: "What this changes" }),
	).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	const save = sheet.getByRole("button", { name: "Switch", exact: true });
	await expect(save).toBeEnabled();
	await untilSaved(page, "envelope.setStyle", () => save.click());
	await expect(sheet).toBeHidden();
	await untilSaved(page, "envelope.revertStyle", () =>
		toast(page, "Switched to Limits")
			.getByRole("button", { name: "Undo" })
			.click(),
	);
});

test("What if: a pretend expense shows what the envelope would have", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	const sheet = await openSheet(page, "whatIf", "What if I spend");
	await sheet.getByRole("combobox", { name: "Envelope" }).click();
	await page.getByRole("option", { name: /Groceries/ }).click();
	await sheet.getByRole("textbox", { name: "Amount" }).fill("500");
	await expect(sheet.getByText("Groceries would have")).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await sheet.getByRole("button", { name: "Done" }).click();
	await expect(sheet).toBeHidden();
});

test.describe("Set up your budget", () => {
	// The admin account has no envelope book and no other flow uses it for money.
	test.use({ storageState: ADMIN_STORAGE_STATE });

	test("Flex: money now, the proposed envelopes, preview, start", async ({
		page,
	}) => {
		test.setTimeout(180_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		const sheet = await openSheet(page, "setup", "Set up your budget");
		await sheet
			.getByRole("textbox", { name: "Amount", exact: true })
			.fill("2000");
		const changes = sheet.getByRole("region", { name: "What this changes" });
		await expect(changes).toContainText("Money to plan");
		await expect(changes).toContainText("USD 2,000.00");
		expect(await bannedOutputOn(page), "banned output").toEqual([]);
		const start = sheet.getByRole("button", { name: "Start my budget" });
		await expect(start).toBeEnabled();
		await untilSaved(page, "envelope.setup", () => start.click());
		await expect(sheet).toBeHidden();
		await expect(toast(page, "Your budget is ready")).toBeVisible();
	});
});

test("Explain: Not planned yet adds up from the server's terms", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const sheet = await openSheet(page, "explain", /How Not planned yet adds up/);
	await expect(sheet.getByText("Money in")).toBeVisible();
	await expect(sheet.getByText("Held for others")).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
});
