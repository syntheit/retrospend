import { expect, type Page, test } from "@playwright/test";
import { Pool } from "pg";
import {
	ADMIN_STORAGE_STATE,
	E2E_DATABASE_URL,
	TEST_USER,
	USER_STORAGE_STATE,
} from "../../constants";
import { bannedOutputOn } from "../../helpers/banned-output";
import { setEnvelopeBudgetMode } from "../../helpers/envelope-flag";
import { gotoReady } from "../../helpers/navigation";
import { untilSaved } from "../../helpers/trpc";
import { trpcMutation } from "./entry-audit";

// The Budget sheets (4C2), opened from the Budget page the way a person does:
// the hero, the notice, an envelope's menu, the header menu and the rail.
// They run on the blank test user's own envelope book. Every money sheet shows
// the server's dry run before Save, and Save ends with an Undo toast that
// calls the server undo. The book (USD) starts with 1,500.00 to assign, a
// Groceries target of 400.00 and 120.00 spent in Everything else, so
// Everything else is overspent by 120.00.

test.use({ storageState: USER_STORAGE_STATE });
test.describe.configure({ mode: "serial" });

const today = () =>
	new Date().toLocaleDateString("en-CA", {
		timeZone: "America/Argentina/Buenos_Aires",
	});

/** The book's own rows, set by SQL where no procedure exists (a style no switch reaches, a past start). */
async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
	const pool = new Pool({ connectionString: E2E_DATABASE_URL });
	try {
		return (await pool.query(text, values)).rows as T[];
	} finally {
		await pool.end();
	}
}

const BOOK_OF_TEST_USER = `(SELECT b.id FROM "budget_book" b JOIN "user" u ON u.id = b."createdById" WHERE u.email = $1)`;

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

async function openBudget(page: Page, path = "/budget"): Promise<void> {
	await gotoReady(page, path);
	await expect(
		page.locator('[data-ui="v2"][data-page="budget"]'),
	).toBeVisible();
	await expect(
		page.locator('[data-slot="budget-hero"], [data-slot="plan-view"]').first(),
	).toBeVisible();
	await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

/** The header's overflow menu: one of its items. */
async function fromMenu(page: Page, item: RegExp | string): Promise<void> {
	await page.getByRole("button", { name: "More actions for Budget" }).click();
	await page.getByRole("menuitem", { name: item }).click();
}

/** An envelope's menu: open its group, then one of its items. */
async function fromEnvelope(
	page: Page,
	group: string,
	envelope: string,
	item: RegExp | string,
): Promise<void> {
	const main = page.getByRole("main");
	const menu = main.getByRole("button", {
		name: `More actions for ${envelope}`,
	});
	if (!(await menu.isVisible()))
		await main.getByRole("button", { name: group, exact: true }).click();
	await menu.click();
	await page.getByRole("menuitem", { name: item }).click();
}

const toast = (page: Page, text: string | RegExp) =>
	page.locator("[data-sonner-toast]").filter({ hasText: text });

test("the book: set up, with an overspent envelope", async ({ page }) => {
	test.setTimeout(180_000);
	await gotoReady(page, "/budget");
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
	// Accounts for the debt sheets: one the budget counts, one it does not,
	// and a card with its terms.
	await trpcMutation(page, "wealth.createAsset", {
		name: "E2E Checking",
		type: "CASH",
		currency: "USD",
		balance: 1000,
		isLiquid: true,
	});
	await trpcMutation(page, "wealth.createAsset", {
		name: "E2E Savings",
		type: "INVESTMENT",
		currency: "USD",
		balance: 200,
		isLiquid: true,
	});
	await trpcMutation(page, "wealth.createAsset", {
		name: "E2E Visa",
		type: "LIABILITY_CREDIT_CARD",
		currency: "USD",
		balance: 400,
		interestRate: 24,
		minimumPayment: 30,
		dueDate: 12,
	});
});

test("Move: from Not planned yet to Groceries, then out again", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBudget(page);
	await fromEnvelope(page, "Spending", "Groceries", /^Move/);
	const sheet = page.getByRole("dialog", { name: "Groceries" });
	await expect(sheet).toBeVisible();
	await sheet.getByRole("textbox", { name: "Amount" }).fill("75");
	const changes = sheet.getByRole("region", { name: "What this changes" });
	await expect(changes).toContainText("USD 75.00");
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
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
	await openBudget(page);
	await fromEnvelope(page, "Spending", "Everything else", /^Cover/);
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
	await openBudget(page);
	await page
		.getByRole("main")
		.getByRole("button", { name: "Cover", exact: true })
		.first()
		.click();
	const sheet = page.getByRole("dialog", { name: "Cover overspending" });
	await expect(sheet).toBeVisible();
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
	await openBudget(page);
	await fromMenu(page, "Use my plan");
	const sheet = page.getByRole("dialog", { name: "Use my plan" });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByText("these jobs")).toBeVisible();
	await expect(sheet.getByText("Groceries")).toBeVisible();
	const changes = sheet.getByRole("region", { name: "What this changes" });
	await expect(changes).toContainText("Not planned yet");
	// Outside a Limits book the Limits figure is not offered, not "could not check".
	await expect(sheet.getByText(/Could not check/)).toHaveCount(0);
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await untilSaved(page, "envelope.usePlan", () =>
		sheet.getByRole("button", { name: "Use my plan", exact: true }).click(),
	);
	await expect(sheet).toBeHidden();
	await untilSaved(page, "envelope.undo", () =>
		toast(page, "Plan used").getByRole("button", { name: "Undo" }).click(),
	);
});

test("Use my plan, Next month: the rest is assigned ahead, one Undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBudget(page);
	await fromMenu(page, "Use my plan");
	const sheet = page.getByRole("dialog", { name: "Use my plan" });
	await sheet.getByRole("button", { name: /^Next month/ }).click();
	await expect(
		sheet.getByRole("region", { name: /Assigned ahead to/ }),
	).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await untilSaved(page, "envelope.usePlan", () =>
		sheet.getByRole("button", { name: "Use my plan", exact: true }).click(),
	);
	await expect(sheet).toBeHidden();
	await untilSaved(page, "envelope.undo", () =>
		toast(page, "Plan used").getByRole("button", { name: "Undo" }).click(),
	);
});

test("Pay down a debt: the card, preview with the balance, save, undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	// A book that pays off debt offers the debt buttons on its hero.
	await sql(
		`UPDATE "budget_book" SET "style" = 'DEBT_PAYOFF' WHERE "createdById" = (SELECT id FROM "user" WHERE email = $1)`,
		[TEST_USER.email],
	);
	await openBudget(page);
	await page
		.getByRole("main")
		.getByRole("button", { name: "Pay down a debt" })
		.click();
	const sheet = page.getByRole("dialog", { name: "Pay down a debt" });
	await expect(sheet).toBeVisible();
	await sheet.getByRole("combobox", { name: "Paid from" }).click();
	await page.getByRole("option", { name: /E2E Checking/ }).click();
	await sheet.getByRole("textbox", { name: "Amount" }).first().fill("100");
	const changes = sheet.getByRole("region", { name: "What this changes" });
	await expect(changes).toContainText("E2E Visa balance");
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await untilSaved(page, "envelope.recordDebtPayment", () =>
		sheet.getByRole("button", { name: "Pay", exact: true }).click(),
	);
	await expect(sheet).toBeHidden();
	await untilSaved(page, "wealth.transfers.delete.save", () =>
		toast(page, "Paid").getByRole("button", { name: "Undo" }).click(),
	);
});

test("Debt payoff plan: the card, the projection, save, undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBudget(page);
	await page
		.getByRole("main")
		.getByRole("button", { name: "Payoff plan" })
		.click();
	const sheet = page.getByRole("dialog", { name: "Debt payoff plan" });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByText("E2E Visa")).toBeVisible();
	await sheet.getByRole("textbox", { name: "Amount" }).fill("50");
	await expect(sheet.getByText("Debt-free by")).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await untilSaved(page, "envelope.savePayoffPlan", () =>
		sheet.getByRole("button", { name: "Save plan" }).click(),
	);
	await untilSaved(page, "envelope.revertPayoffPlan", () =>
		toast(page, "Payoff plan saved")
			.getByRole("button", { name: "Undo" })
			.click(),
	);
	await sql(
		`UPDATE "budget_book" SET "style" = 'FLEX' WHERE "createdById" = (SELECT id FROM "user" WHERE email = $1)`,
		[TEST_USER.email],
	);
});

test("Money in opens from the rail with what the server has", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBudget(page);
	await page
		.getByRole("main")
		.getByRole("button", { name: "Income and rules" })
		.click();
	const income = page.getByRole("dialog", { name: /^Money in/ });
	await expect(income).toBeVisible();
	await expect(income.getByText("Money in", { exact: true })).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await income.getByRole("button", { name: "Done" }).click();
	await expect(income).toBeHidden();
});

test("Plan next month opens the apply sheet with what the server has", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBudget(page);
	await page
		.getByRole("button", { name: /^Plan / })
		.first()
		.click();
	await expect(page.locator('[data-slot="plan-view"]')).toBeVisible();
	await page.getByRole("button", { name: "Fill from targets" }).click();
	await page.getByRole("button", { name: "Apply plan" }).click();
	const plan = page.getByRole("dialog", { name: /^Apply the/ });
	await expect(plan).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await untilSaved(page, "envelope.applyDraft", () =>
		plan.getByRole("button", { name: "Apply plan" }).click(),
	);
	await untilSaved(page, "envelope.unapplyDraft", () =>
		toast(page, "plan saved").getByRole("button", { name: "Undo" }).click(),
	);
});

test("Rules: add a rule, see it in one sentence, remove it", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBudget(page);
	await fromMenu(page, "Income rules");
	const sheet = page.getByRole("dialog", { name: "Income rules" });
	await expect(sheet).toBeVisible();
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
	await sheet
		.getByRole("button", { name: "More actions for E2E save first" })
		.click();
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
	await openBudget(page);
	await fromMenu(page, "Budget style");
	const sheet = page.getByRole("dialog", { name: "Budget style" });
	await expect(sheet).toBeVisible();
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
	await openBudget(page);
	await fromEnvelope(page, "Spending", "Groceries", /^What if/);
	const sheet = page.getByRole("dialog", { name: /^What if I spend/ });
	await expect(sheet).toBeVisible();
	await sheet.getByRole("textbox", { name: "Amount" }).fill("500");
	await expect(sheet.getByText("Groceries would have")).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await sheet.getByRole("button", { name: "Done" }).click();
	await expect(sheet).toBeHidden();
});

test("Explain: Left to spend adds up from the server's terms", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBudget(page);
	await page
		.getByRole("main")
		.getByRole("button", { name: "How this adds up" })
		.click();
	const sheet = page.getByRole("dialog", { name: /How .* adds up/ });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByText("Carried in")).toBeVisible();
	await expect(sheet.getByText("Activity")).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
});

test("Help: what the words mean", async ({ page }) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBudget(page);
	await fromMenu(page, "What the words mean");
	const sheet = page.getByRole("dialog", { name: "What the words mean" });
	await expect(sheet).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
});

test.describe("Set up your budget", () => {
	// The admin account has no envelope book and no other flow uses it for money.
	test.use({ storageState: ADMIN_STORAGE_STATE });

	test("Flex: the stepped wizard, money now, envelopes, preview, start", async ({
		page,
	}) => {
		test.setTimeout(180_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await gotoReady(page, "/budget");
		await page
			.getByRole("main")
			.getByRole("button", { name: "Set up your budget" })
			.click();
		const sheet = page.getByRole("dialog", { name: "Set up your budget" });
		await expect(sheet.getByText("Step 1 of 3")).toBeVisible();
		await expect(
			sheet.getByRole("heading", { name: "How do you like to budget?" }),
		).toBeVisible();
		await sheet.getByRole("button", { name: "Continue" }).click();
		await expect(sheet.getByText("Step 2 of 3")).toBeVisible();
		await sheet
			.getByRole("textbox", { name: "Amount", exact: true })
			.fill("2000");
		await sheet.getByRole("button", { name: "Continue" }).click();
		await expect(sheet.getByText("Step 3 of 3")).toBeVisible();
		const changes = sheet.getByRole("region", { name: "What this changes" });
		await expect(changes).toContainText("Money to plan");
		await expect(changes).toContainText("USD 2,000.00");
		expect(await bannedOutputOn(page), "banned output").toEqual([]);
		// The stop (the plan costs more than you have) needs a history with bills;
		// this account has none, so the server test covers it (setup.pg.test.ts).
		const start = sheet.getByRole("button", { name: "Start my budget" });
		await expect(start).toBeEnabled();
		await untilSaved(page, "envelope.setup", () => start.click());
		await expect(sheet).toBeHidden();
		await expect(toast(page, "Your budget is ready")).toBeVisible();
	});
});

test("A closed month: its summary opens from the page", async ({ page }) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	// The budget started in August, so August and September are closed.
	await sql(
		`UPDATE "budget_book" SET "startMonth" = 202608, "startDate" = '2026-08-01T00:00:00Z' WHERE "createdById" = (SELECT id FROM "user" WHERE email = $1)`,
		[TEST_USER.email],
	);
	await sql(
		`UPDATE "book_period" SET "fromMonth" = 202608 WHERE "bookId" = ${BOOK_OF_TEST_USER}`,
		[TEST_USER.email],
	);
	await sql(
		`UPDATE "expense" SET "date" = '2026-08-01T00:00:00Z' WHERE "id" = (SELECT "startingBalanceExpenseId" FROM "budget_book" b JOIN "user" u ON u.id = b."createdById" WHERE u.email = $1)`,
		[TEST_USER.email],
	);
	await openBudget(page, "/budget?month=202609");
	await page
		.getByRole("main")
		.getByRole("button", { name: /Month summary|How it adds up/ })
		.first()
		.click();
	const sheet = page.getByRole("dialog", { name: /is closed$/ });
	await expect(sheet).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
});

test("Welcome back: after time away the catch-up opens from the page", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await sql(
		`UPDATE "budget_book" SET "lastOpenedAt" = now() - interval '40 days' WHERE "createdById" = (SELECT id FROM "user" WHERE email = $1)`,
		[TEST_USER.email],
	);
	await openBudget(page);
	await page
		.getByRole("main")
		.getByRole("button", { name: "Catch up" })
		.click();
	const sheet = page.getByRole("dialog", { name: "Welcome back" });
	await expect(sheet).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
});
