import { expect, type Locator, type Page, test } from "@playwright/test";
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
	// The older specs (e2e/expenses.spec.ts) spend as this same user and leave
	// their rows behind, which would add to the 120.00 the book starts with.
	await sql(
		`DELETE FROM "expense" WHERE "userId" = (SELECT id FROM "user" WHERE email = $1)`,
		[TEST_USER.email],
	);
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
	await fromEnvelope(page, "Spending", "Groceries", /^Move money/);
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
	// A debt whose interest outruns the payment never ends: a clear state, not a date.
	await trpcMutation(page, "wealth.createAsset", {
		name: "E2E Shark",
		type: "LIABILITY_CREDIT_CARD",
		currency: "USD",
		balance: 1000,
		interestRate: 600,
		minimumPayment: 10,
		dueDate: 12,
	});
	await openBudget(page);
	const hero = page.locator('[data-slot="budget-hero"]');
	await expect(hero.getByText("Never at this payment")).toBeVisible();
	await expect(hero.getByText(/interest is more than you pay/)).toBeVisible();
	await hero.getByRole("button", { name: "Payoff plan" }).click();
	const plan = page.getByRole("dialog", { name: "Debt payoff plan" });
	await expect(plan.getByText(/interest is more than you pay/)).toBeVisible();
	await plan.getByRole("button", { name: "Cancel" }).click();
	await sql(
		`UPDATE "budget_book" SET "style" = 'FLEX', "fundingSource" = 'INCOME' WHERE "createdById" = (SELECT id FROM "user" WHERE email = $1)`,
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

test("Target: a new monthly amount for Groceries, preview, save, undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBudget(page);
	await fromEnvelope(page, "Spending", "Groceries", "Edit target");
	const sheet = page.getByRole("dialog", { name: "Target for Groceries" });
	await expect(sheet).toBeVisible();
	await sheet.getByRole("textbox", { name: "Amount" }).fill("450");
	const changes = sheet.getByRole("region", { name: "What this changes" });
	await expect(changes).toContainText("USD 450.00");
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await untilSaved(page, "envelope.setTarget", () =>
		sheet.getByRole("button", { name: "Save target" }).click(),
	);
	await expect(sheet).toBeHidden();
	await untilSaved(page, "envelope.undoChange", () =>
		toast(page, "Target saved").getByRole("button", { name: "Undo" }).click(),
	);
});

test("Add envelope: name, group, preview, save", async ({ page }) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBudget(page);
	await fromMenu(page, "Add envelope");
	const sheet = page.getByRole("dialog", { name: "Add envelope" });
	await expect(sheet).toBeVisible();
	await sheet.getByRole("textbox", { name: "Name" }).fill("E2E Gym");
	await expect(
		sheet.getByRole("region", { name: "What this changes" }),
	).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await untilSaved(page, "envelope.createEnvelope", () =>
		sheet.getByRole("button", { name: "Add envelope" }).click(),
	);
	await expect(sheet).toBeHidden();
	await expect(toast(page, "Added E2E Gym")).toBeVisible();
});

test("Edit envelope: rename, preview, save, undo", async ({ page }) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBudget(page);
	await fromEnvelope(page, "Bills", "E2E Gym", "Rename or edit categories");
	const sheet = page.getByRole("dialog", { name: "Edit E2E Gym" });
	await expect(sheet).toBeVisible();
	await sheet.getByRole("textbox", { name: "Name" }).fill("E2E Gym Club");
	await expect(
		sheet.getByRole("region", { name: "What this changes" }),
	).toBeVisible();
	await untilSaved(page, "envelope.updateEnvelope", () =>
		sheet.getByRole("button", { name: "Save", exact: true }).click(),
	);
	await expect(sheet).toBeHidden();
	await untilSaved(page, "envelope.undoChange", () =>
		toast(page, "Saved E2E Gym Club")
			.getByRole("button", { name: "Undo" })
			.click(),
	);
});

test("Combine envelopes: E2E Gym into Groceries, preview, save, undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBudget(page);
	await fromMenu(page, "Combine envelopes");
	const sheet = page.getByRole("dialog", { name: "Combine envelopes" });
	await expect(sheet).toBeVisible();
	await sheet.getByRole("combobox", { name: "Keep this one" }).click();
	await page.getByRole("option", { name: /Groceries/ }).click();
	await sheet.getByRole("checkbox", { name: "E2E Gym" }).click();
	await expect(
		sheet.getByRole("region", { name: "What this changes" }),
	).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await untilSaved(page, "envelope.mergeEnvelopes", () =>
		sheet.getByRole("button", { name: "Combine", exact: true }).click(),
	);
	await expect(sheet).toBeHidden();
	await untilSaved(page, "envelope.undoChange", () =>
		toast(page, "Combined").getByRole("button", { name: "Undo" }).click(),
	);
});

test("Archive an envelope: its own preview, save, undo", async ({ page }) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBudget(page);
	await fromEnvelope(page, "Bills", "E2E Gym", "Rename or edit categories");
	await page.getByRole("button", { name: "Archive envelope" }).click();
	const sheet = page.getByRole("dialog", { name: "Archive E2E Gym" });
	await expect(sheet).toBeVisible();
	await expect(
		sheet.getByRole("region", { name: "What this changes" }),
	).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await untilSaved(page, "envelope.archiveEnvelope", () =>
		sheet.getByRole("button", { name: "Archive", exact: true }).click(),
	);
	await expect(sheet).toBeHidden();
	await untilSaved(page, "envelope.undoChange", () =>
		toast(page, "Archived E2E Gym")
			.getByRole("button", { name: "Undo" })
			.click(),
	);
});

test("Can I afford it: one amount, one answer from the server", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBudget(page);
	await page
		.getByRole("main")
		.getByRole("button", { name: "Can I afford something?" })
		.click();
	const sheet = page.getByRole("dialog", { name: "Can I afford it?" });
	await expect(sheet).toBeVisible();
	await sheet.getByRole("textbox", { name: "Amount" }).fill("50");
	await expect(
		sheet.getByText(/Yes\.|Not quite\.|Not this month\.|It fits/).first(),
	).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await sheet.getByRole("button", { name: "Done" }).click();
	await expect(sheet).toBeHidden();
});

test("Assign: from the rail and from an envelope's menu; clear, type, preview, save, undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBudget(page);
	// The Not planned yet line in the rail opens it.
	await page
		.locator('[data-slot="budget-rail"]')
		.getByRole("button", { name: "Assign money" })
		.click();
	const first = page.getByRole("dialog", { name: /^Assign / });
	await expect(first).toBeVisible();
	await first.getByRole("button", { name: "Cancel" }).click();
	await expect(first).toBeHidden();

	await fromEnvelope(page, "Spending", "Groceries", "Assign money");
	const sheet = page.getByRole("dialog", { name: /^Assign / });
	await expect(sheet).toBeVisible();
	await sheet.getByRole("button", { name: "Clear" }).click();
	await sheet.getByRole("textbox", { name: "Assign to Groceries" }).fill("250");
	const changes = sheet.getByRole("region", { name: "What this changes" });
	await expect(changes.getByText("Groceries")).toBeVisible();
	await expect(changes).toContainText("USD 250.00");
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	const save = sheet.getByRole("button", { name: "Assign", exact: true });
	await expect(save).toBeEnabled();
	await untilSaved(page, "envelope.assign", () => save.click());
	await expect(sheet).toBeHidden();
	await untilSaved(page, "envelope.undo", () =>
		toast(page, "Assigned").getByRole("button", { name: "Undo" }).click(),
	);
});

test("Move to Wealth from an envelope's menu, and Move from Wealth from the rail", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBudget(page);
	await fromEnvelope(page, "Spending", "Groceries", "Move to Wealth");
	const to = page.getByRole("dialog", { name: "Move Groceries to Wealth" });
	await expect(to).toBeVisible();
	await to.getByRole("textbox", { name: "Amount", exact: true }).fill("60");
	await expect(
		to.getByRole("region", { name: "What this changes" }),
	).toContainText("Groceries");
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await untilSaved(page, "entry.transfer.save", () =>
		to.getByRole("button", { name: "Move", exact: true }).click(),
	);
	await expect(to).toBeHidden();
	await untilSaved(page, "wealth.transfers.delete.save", () =>
		toast(page, "Moved").getByRole("button", { name: "Undo" }).click(),
	);

	await openBudget(page);
	await page
		.locator('[data-slot="budget-rail"]')
		.getByRole("button", { name: "Move from Wealth" })
		.click();
	const from = page.getByRole("dialog", { name: "Move from Wealth" });
	await expect(from).toBeVisible();
	await from.getByRole("radio", { name: "No, just count it" }).click();
	await from.getByRole("textbox", { name: "Amount" }).fill("50");
	await expect(
		from.getByRole("region", { name: "What this changes" }),
	).toContainText("Not planned yet");
	await untilSaved(page, "wealth.income.moveIn.save", () =>
		from.getByRole("button", { name: "Move in" }).click(),
	);
	await expect(from).toBeHidden();
	await untilSaved(page, "wealth.income.undoMoveIn.save", () =>
		toast(page, "Counted").getByRole("button", { name: "Undo" }).click(),
	);
});

test("Reconcile: a notice once a month has turned, and the header menu", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	// Checked in a month before this one: Needs you asks again.
	await sql(
		`UPDATE "budget_book" SET "reconciledAt" = now() - interval '70 days' WHERE "createdById" = (SELECT id FROM "user" WHERE email = $1)`,
		[TEST_USER.email],
	);
	await openBudget(page);
	const main = page.getByRole("main");
	await expect(
		main.getByText(/Check that the budget matches your bank/),
	).toBeVisible();
	await main.getByRole("button", { name: "Check", exact: true }).click();
	const sheet = page.getByRole("dialog", {
		name: "Does this match your bank?",
	});
	await expect(sheet).toBeVisible();
	await sheet.getByRole("textbox", { name: "Amount" }).fill("1234");
	await expect(
		sheet.getByRole("region", { name: "What this changes" }),
	).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await untilSaved(page, "envelope.reconcile", () =>
		sheet.getByRole("button", { name: "Record" }).click(),
	);
	await expect(sheet).toBeHidden();
	await untilSaved(page, "envelope.removeAdjustment", () =>
		toast(page, "Recorded an adjustment")
			.getByRole("button", { name: "Undo" })
			.click(),
	);
	// The header menu opens the same sheet.
	await openBudget(page);
	await fromMenu(page, "Check against your bank");
	await expect(
		page.getByRole("dialog", { name: "Does this match your bank?" }),
	).toBeVisible();
});

test("Starting money: a notice while it is unconfirmed, preview, save, undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await sql(
		`UPDATE "budget_book" SET "startingMoneyConfirmedAt" = NULL, "reconciledAt" = now() WHERE "createdById" = (SELECT id FROM "user" WHERE email = $1)`,
		[TEST_USER.email],
	);
	await openBudget(page);
	const main = page.getByRole("main");
	await expect(main.getByText(/Say how much you have right now/)).toBeVisible();
	await main.getByRole("button", { name: "Confirm", exact: true }).click();
	const sheet = page.getByRole("dialog", { name: "Starting money" });
	await expect(sheet).toBeVisible();
	await sheet.getByRole("textbox", { name: "Amount" }).fill("1600");
	await expect(
		sheet.getByRole("region", { name: "What this changes" }),
	).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await untilSaved(page, "envelope.confirmStartingMoney", () =>
		sheet.getByRole("button", { name: "Confirm", exact: true }).click(),
	);
	await expect(sheet).toBeHidden();
	await untilSaved(page, "envelope.undoChange", () =>
		toast(page, "Starting money confirmed")
			.getByRole("button", { name: "Undo" })
			.click(),
	);
	await sql(
		`UPDATE "budget_book" SET "startingMoneyConfirmedAt" = now() WHERE "createdById" = (SELECT id FROM "user" WHERE email = $1)`,
		[TEST_USER.email],
	);
});

/**
 * A Limits book: To assign and Not planned yet are hidden everywhere (the
 * rail, the menus), Money in stays, and the groups' Left adds up to the
 * hero's net Left in your limits (the server's figures, never summed on the page).
 */
async function expectLimitsPage(page: Page): Promise<void> {
	const main = page.getByRole("main");
	const rail = page.locator('[data-slot="budget-rail"]');
	await expect(rail.getByText("Money in", { exact: true })).toBeVisible();
	for (const word of [
		/Not planned yet/,
		/To assign/,
		/Assign money/,
		/Move from Wealth/,
	])
		await expect(main.getByText(word)).toHaveCount(0);
	const minor = async (loc: Locator) =>
		Number(await loc.getAttribute("data-minor"));
	const hero = await minor(
		page.locator('[data-slot="budget-hero"] [data-slot="money"]').first(),
	);
	const rows = main.locator("tr[data-envelope-group]");
	let groups = 0;
	for (const row of await rows.all())
		groups += await minor(row.locator('[data-slot="money"]').nth(2));
	expect(groups, "group Left adds up to the hero's net Left").toBe(hero);
	// Menus carry no way into To assign.
	await main.getByRole("button", { name: "More actions for Budget" }).click();
	await expect(page.getByRole("menuitem", { name: "Use my plan" })).toHaveCount(
		0,
	);
	await page.keyboard.press("Escape");
	await main
		.getByRole("button", { name: "More actions for Groceries" })
		.click();
	await expect(
		page.getByRole("menuitem", { name: /^Assign money/ }),
	).toHaveCount(0);
	await expect(
		page.getByRole("menuitem", { name: /^Move from Wealth/ }),
	).toHaveCount(0);
	await page.keyboard.press("Escape");
}

test("Set a limit: a Limits envelope with no limit gets one, undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await sql(
		`UPDATE "budget_book" SET "style" = 'LIMITS', "fundingSource" = 'TARGETS' WHERE "createdById" = (SELECT id FROM "user" WHERE email = $1)`,
		[TEST_USER.email],
	);
	try {
		await openBudget(page);
		const main = page.getByRole("main");
		await expectLimitsPage(page);
		// Limits groups start open; E2E Gym, added above, has no limit.
		const row = main.locator("tr", { hasText: "E2E Gym" });
		await row.getByRole("button", { name: "Set a limit" }).click();
		const sheet = page.getByRole("dialog", { name: "Set a limit" });
		await expect(sheet).toBeVisible();
		await sheet.getByRole("textbox", { name: "Amount" }).fill("200");
		await expect(
			sheet.getByRole("region", { name: "What this changes" }),
		).toBeVisible();
		await untilSaved(page, "envelope.setLimit", () =>
			sheet.getByRole("button", { name: "Set limit" }).click(),
		);
		await expect(sheet).toBeHidden();
		await untilSaved(page, "envelope.revertLimit", () =>
			toast(page, "limit is").getByRole("button", { name: "Undo" }).click(),
		);
	} finally {
		await sql(
			`UPDATE "budget_book" SET "style" = 'FLEX', "fundingSource" = 'INCOME' WHERE "createdById" = (SELECT id FROM "user" WHERE email = $1)`,
			[TEST_USER.email],
		);
	}
});

test("Shares with no envelope: listed in Splits, pick a category, undo", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	// Paz paid a dinner and split it with this user; no category of theirs matches.
	await sql(
		`INSERT INTO "shadow_profile" ("id", "createdById", "name", "updatedAt") SELECT 'e2e_shadow_paz2', id, 'E2E Paz', now() FROM "user" WHERE email = $1 ON CONFLICT DO NOTHING`,
		[TEST_USER.email],
	);
	await sql(
		`INSERT INTO "shared_transaction" ("id", "description", "amount", "currency", "date", "paidByType", "paidById", "createdByType", "createdById", "updatedAt") VALUES ('e2e_split_dinner', 'E2E dinner', 80, 'USD', now(), 'shadow', 'e2e_shadow_paz2', 'shadow', 'e2e_shadow_paz2', now()) ON CONFLICT DO NOTHING`,
	);
	await sql(
		`INSERT INTO "split_participant" ("id", "transactionId", "participantType", "participantId", "shareAmount", "verificationStatus", "updatedAt") SELECT 'e2e_share_me', 'e2e_split_dinner', 'user', id, 40, 'ACCEPTED', now() FROM "user" WHERE email = $1 ON CONFLICT DO NOTHING`,
		[TEST_USER.email],
	);
	await sql(
		`INSERT INTO "split_participant" ("id", "transactionId", "participantType", "participantId", "shareAmount", "verificationStatus", "updatedAt") VALUES ('e2e_share_paz', 'e2e_split_dinner', 'shadow', 'e2e_shadow_paz2', 40, 'ACCEPTED', now()) ON CONFLICT DO NOTHING`,
	);
	await openBudget(page);
	await page
		.locator('[data-slot="budget-rail"]')
		.getByRole("button", { name: /Shares/i })
		.first()
		.click();
	const sheet = page.getByRole("dialog", { name: "Splits waiting for you" });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByText("No envelope yet")).toBeVisible();
	await sheet
		.getByRole("button", { name: /^Pick a category for the share/ })
		.click();
	const pick = page.getByRole("dialog", { name: "Pick a category" });
	await expect(pick).toBeVisible();
	await pick.getByRole("option", { name: /E2E coffee/ }).click();
	await expect(
		pick.getByRole("region", { name: "What this changes" }),
	).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
	await untilSaved(page, "envelope.setShareCategory", () =>
		pick.getByRole("button", { name: "Put it there" }).click(),
	);
	await expect(pick).toBeHidden();
	await untilSaved(page, "envelope.setShareCategory", () =>
		toast(page, "Share moved").getByRole("button", { name: "Undo" }).click(),
	);
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
