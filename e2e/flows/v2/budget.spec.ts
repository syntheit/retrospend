import { randomUUID } from "node:crypto";
import {
	type APIRequestContext,
	expect,
	type Page,
	type PlaywrightWorkerArgs,
	test,
} from "@playwright/test";
import { Pool } from "pg";
import {
	ADMIN_STORAGE_STATE,
	E2E_BASE_URL,
	E2E_DATABASE_URL,
	personaStorageState,
} from "../../constants";
import { MARTIN } from "../../fixtures/personas";
import { bannedOutputOn } from "../../helpers/banned-output";
import {
	collectFigureTags,
	FigureAudit,
	httpFigureFetcher,
} from "../../helpers/figures";
import { gotoReady } from "../../helpers/navigation";

// The redesigned Budget (uiV2 with the envelope budget on). The envelope
// budget is a second app-wide flag and the seed has no book, so this flow
// turns the flag on, sets up a Flex book for Martín (no other flow reads a
// book of his) through the engine's own procedures, puts money in each
// envelope, and removes both afterwards. Actions open sheets by id; the
// sheets land with their own flows.

test.use({ storageState: personaStorageState(MARTIN.username) });
test.describe.configure({ mode: "serial" });

async function trpc<T>(
	api: APIRequestContext,
	kind: "query" | "mutation",
	path: string,
	input: unknown,
): Promise<T> {
	const headers = { Origin: E2E_BASE_URL, "content-type": "application/json" };
	const res =
		kind === "query"
			? await api.get(
					`/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
					{ headers },
				)
			: await api.post(`/api/trpc/${path}`, { headers, data: { json: input } });
	expect(res.ok(), `${path} answered ${res.status()}`).toBe(true);
	return (await res.json()).result.data.json as T;
}

async function setEnvelopeBudgetMode(
	playwright: PlaywrightWorkerArgs["playwright"],
	mode: "OFF" | "ALL",
): Promise<void> {
	const pool = new Pool({ connectionString: E2E_DATABASE_URL });
	try {
		await pool.query(`UPDATE "app_settings" SET "envelopeBudgetMode" = $1`, [
			mode,
		]);
		// A run of this file alone has no ui-v2-on setup before it.
		if (mode === "ALL")
			await pool.query(`UPDATE "app_settings" SET "uiV2Mode" = 'ALL'`);
		if (mode === "OFF") {
			await pool.query(`DELETE FROM "budget_book" WHERE "createdById" = $1`, [
				MARTIN.id,
			]);
			// Setup wrote the starting balance as a money-in row of his.
			await pool.query(
				`DELETE FROM "expense" WHERE "userId" = $1 AND "entryKind" = 'STARTING_BALANCE'`,
				[MARTIN.id],
			);
		}
	} finally {
		await pool.end();
	}
	// The server reads flags through a settings cache; an admin write refreshes it.
	const admin = await playwright.request.newContext({
		baseURL: E2E_BASE_URL,
		storageState: ADMIN_STORAGE_STATE,
	});
	try {
		await trpc(admin, "mutation", "admin.updateSettings", {});
	} finally {
		await admin.dispose();
	}
}

/** The first of next month, as the bills' due date. */
function nextFirst(): string {
	const d = new Date();
	const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
	return next.toISOString().slice(0, 10);
}

/** A Flex book: Bills, Spending and Savings, two bills, money now, money in each envelope. */
async function seedBook(api: APIRequestContext): Promise<void> {
	const bill = (key: string, name: string, amountMinor: number) => ({
		key,
		name,
		groupKey: "bills",
		kind: "BILL",
		isDefault: false,
		categoryIds: [],
		target: {
			kind: "BILL",
			amountMinor,
			dueDate: nextFirst(),
			repeat: "MONTHLY",
		},
	});
	await trpc(api, "mutation", "envelope.setup", {
		style: "FLEX",
		startingMoneyMinor: 300_000_000,
		groups: [
			{ key: "bills", name: "Bills", role: "BILLS" },
			{ key: "spending", name: "Spending", role: "SPENDING" },
			{ key: "savings", name: "Savings", role: "SAVINGS" },
		],
		envelopes: [
			bill("rent", "Rent", 50_000_000),
			bill("phone", "Phone", 5_000_000),
			{
				key: "spending",
				name: "Spending",
				groupKey: "spending",
				kind: "MONTHLY",
				isDefault: true,
				categoryIds: [],
				target: { kind: "MONTHLY", amountMinor: 60_000_000 },
			},
			{
				key: "savings",
				name: "Savings",
				groupKey: "savings",
				kind: "SAVINGS",
				isDefault: false,
				categoryIds: [],
				target: { kind: "SAVINGS", amountMinor: 100_000_000 },
			},
		],
	});
	const month = await trpc<{
		month: { key: number };
		groups: { envelopes: { id: string; name: string }[] }[];
	}>(api, "query", "envelope.getMonth", {});
	const amounts: Record<string, number> = {
		Rent: 50_000_000,
		Phone: 5_000_000,
		Spending: 60_000_000,
		Savings: 20_000_000,
	};
	const items = month.groups
		.flatMap((g) => g.envelopes)
		.map((e) => ({
			id: randomUUID(),
			envelopeId: e.id,
			amountMinor: amounts[e.name] ?? 0,
		}))
		.filter((i) => i.amountMinor > 0);
	await trpc(api, "mutation", "envelope.assign", {
		batchId: randomUUID(),
		month: month.month.key,
		mode: "set",
		items,
	});
}

test.beforeAll(async ({ playwright }) => {
	test.setTimeout(120_000);
	// A run that died before its afterAll left a book behind.
	await setEnvelopeBudgetMode(playwright, "OFF");
	await setEnvelopeBudgetMode(playwright, "ALL");
	const api = await playwright.request.newContext({
		baseURL: E2E_BASE_URL,
		storageState: personaStorageState(MARTIN.username),
	});
	try {
		await seedBook(api);
	} finally {
		await api.dispose();
	}
});

test.afterAll(async ({ playwright }) => {
	await setEnvelopeBudgetMode(playwright, "OFF");
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

test("Budget: one number, the groups, and every figure matches the server", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBudget(page);
	const main = page.getByRole("main");

	await expect(
		main.getByRole("heading", { name: "Budget", level: 1 }),
	).toBeVisible();
	await expect(main.getByText(/^Left to spend in /)).toBeVisible();
	await expect(
		main.getByRole("button", { name: "Can I afford something?" }),
	).toBeVisible();
	// The three groups, each folded to one row (Flex).
	const table = main.getByRole("table", { name: "Envelopes" });
	for (const name of ["Bills", "Spending", "Savings"])
		await expect(table.getByRole("button", { name })).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);

	// A group opens to its envelopes, with their target lines and bars.
	await table.getByRole("button", { name: "Bills" }).click();
	await expect(table.getByText("Rent")).toBeVisible();
	await expect(table.getByText(/ by /).first()).toBeVisible();

	// Every figure on the page, the rows' Left and Spent included (the
	// figures endpoint narrows them by envelope), is what the server says.
	const audit = new FigureAudit(httpFigureFetcher(page.request));
	expect(await audit.checkPage(page, "budget", "budgetPage")).toEqual([]);
	const ids = (await collectFigureTags(page)).tags.map((t) => t.id ?? "");
	expect(ids.filter((id) => id.startsWith("envelope.left:"))).toHaveLength(2);
	expect(ids.filter((id) => id.startsWith("envelope.spent:"))).toHaveLength(2);
	// Search narrows the list only.
	await main.getByRole("searchbox", { name: "Search envelopes" }).fill("phone");
	await expect(table.getByText("Phone")).toBeVisible();
	await expect(table.getByText("Rent")).toHaveCount(0);
});

test("Budget: open next month, then come back; the URL names the month", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBudget(page);
	const main = page.getByRole("main");
	const switcher = main.locator('[data-slot="month-switch"]');
	const label = switcher.getByRole("button", { name: "Choose a month" });
	const current = (await label.innerText()).trim();

	// The budget started this month: nothing earlier to open.
	await expect(
		switcher.getByRole("button", { name: "Previous month" }),
	).toBeDisabled();
	await switcher.getByRole("button", { name: "Next month" }).click();
	await expect(page).toHaveURL(/month=\d{6}/);
	await expect(label).not.toHaveText(current);
	await expect(
		switcher.getByRole("button", { name: "Next month" }),
	).toBeDisabled();
	// Next month is the plan: a draft, nothing moves until it is applied.
	await expect(main.locator('[data-slot="plan-view"]')).toBeVisible();
	expect(await bannedOutputOn(page), "banned output").toEqual([]);

	await switcher.getByRole("button", { name: "Previous month" }).click();
	await expect(page).not.toHaveURL(/month=/);
	await expect(label).toHaveText(current);

	// The playground's old link lands on the plan month.
	await openBudget(page, "/budget?view=plan");
	await expect(label).not.toHaveText(current);
});

test("Budget at 390: the phone list, no sideways scroll", async ({ page }) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 390, height: 844 });
	await openBudget(page);
	const main = page.getByRole("main");
	await expect(main.getByText(/^Left to spend in /)).toBeVisible();
	await expect(main.getByRole("button", { name: /^Bills/ })).toBeVisible();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth,
	);
	expect(overflow).toBeLessThanOrEqual(0);
	expect(await bannedOutputOn(page), "banned output").toEqual([]);
});
