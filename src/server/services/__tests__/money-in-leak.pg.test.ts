/**
 * The money-in leak test (IMPLEMENTATION §7.2, risk §10 row 1): money in sits
 * in the expense table next to spending, so every reader of spending is run
 * for users who have the characterization ledger plus money in, and compared
 * with a user who has the ledger alone.
 *
 * - Income, own transfers (NOT_SPENDING), starting balances and adjustments
 *   change no reader at all: no total, list, count, duplicate check or title
 *   suggestion.
 * - A refund nets against spending in its category and month (D27), and no
 *   list shows it until the Activity rebuild labels money in.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureIncomeCategories } from "~/server/services/money-in.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	EXPECTED_LISTED,
	EXPECTED_READINGS,
} from "./spending-expected";
import {
	at,
	expenseData,
	NOW,
	type Row,
	type SpendingFixture,
	seedSpendingFixture,
} from "./spending-fixture";
import {
	callers,
	MONEY_IN_PROBE,
	readAllSpendingReaders,
} from "./spending-readers";

vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

type Readings = Awaited<ReturnType<typeof readAllSpendingReaders>>;

async function addRows(fixture: SpendingFixture, rows: Row[]) {
	await adminDb.expense.createMany({
		data: rows.map((row) => expenseData(fixture.userId, row)),
	});
}

/** Money in of every kind, dated inside the ledger's months and shaped to trip each reader. */
async function addMoneyIn(fixture: SpendingFixture) {
	const income = await ensureIncomeCategories(adminDb, fixture.userId);
	const salary = income.find((c) => c.name === "Salary")?.id;
	const gifts = income.find((c) => c.name === "Gifts")?.id;
	await addRows(fixture, [
		{
			title: "Salary",
			amount: 1_000_000,
			date: at("2026-03-01"),
			categoryId: salary,
			direction: "IN",
			inType: "INCOME",
		},
		// Inside the last 24 hours.
		{
			title: "Salary",
			amount: 1_000_000,
			date: new Date("2026-04-10T06:00:00.000Z"),
			categoryId: salary,
			direction: "IN",
			inType: "INCOME",
		},
		// Same title, amount and day as an expense: duplicate checks and title suggestions must not see it.
		{
			title: "Super Mar",
			amount: 12_000,
			date: at("2026-03-05"),
			categoryId: gifts,
			direction: "IN",
			inType: "INCOME",
		},
		{
			title: "Upwork",
			amount: 100,
			currency: "USD",
			date: at("2026-03-20"),
			categoryId: salary,
			direction: "IN",
			inType: "INCOME",
		},
		// An own transfer out, in a spending category, and its matching transfer in.
		{
			title: "Super card payment",
			amount: 50_000,
			date: at("2026-03-10"),
			categoryId: fixture.groceries.id,
			entryKind: "NOT_SPENDING",
		},
		{
			title: "From savings",
			amount: 50_000,
			date: at("2026-03-10"),
			direction: "IN",
			entryKind: "NOT_SPENDING",
		},
		{
			title: "Starting money",
			amount: 500_000,
			date: at("2026-01-01"),
			direction: "IN",
			entryKind: "STARTING_BALANCE",
		},
		{
			title: "Reconcile up",
			amount: 3_000,
			date: at("2026-03-15"),
			direction: "IN",
			entryKind: "ADJUSTMENT",
		},
		{
			title: "Reconcile down",
			amount: 4_000,
			date: at("2026-03-16"),
			entryKind: "ADJUSTMENT",
		},
		// Income with no category, shaped as the only match for the
		// duplicate, title and CSV import probes.
		{ ...MONEY_IN_PROBE, direction: "IN", inType: "INCOME" },
		// Income filed under an expense category: only the refund filter's
		// inType keeps it out of Groceries.
		{
			title: "Cashback",
			amount: 3_000,
			date: at("2026-03-08"),
			categoryId: fixture.groceries.id,
			direction: "IN",
			inType: "INCOME",
		},
	]);
	await addSidecarIncome(fixture.userId);
}

/** Recurring income as the Go sidecar posts it (sidecar/tasks/recurring.go), raw SQL included. */
async function addSidecarIncome(userId: string) {
	const template = await adminDb.recurringTemplate.create({
		data: {
			userId,
			name: "Acme salary",
			amount: 900_000,
			currency: "ARS",
			frequency: "MONTHLY",
			nextDueDate: at("2026-04-05"),
			direction: "IN",
		},
	});
	await adminDb.$executeRaw`
		INSERT INTO expense (
			id, "userId", title, amount, currency, date, "categoryId",
			"amountInUSD", "exchangeRate", "pricingSource", "recurringTemplateId",
			status, direction, "inType", "createdAt", "updatedAt"
		) VALUES (
			gen_random_uuid()::text, ${userId}, ${template.name}, ${"900000.00000000"}::numeric, 'ARS',
			${at("2026-03-05")}, NULL, 900, 1000, 'RECURRING', ${template.id}, 'FINALIZED',
			${"IN"}::"ExpenseDirection", ${"INCOME"}::"InType", NOW(), NOW()
		)`;
}

describe("money in never reaches a spending reader", () => {
	let plain: Readings;
	let withMoneyIn: Readings;
	let withRefund: Readings;

	beforeAll(async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
		const [a, b, c] = [
			await seedSpendingFixture(),
			await seedSpendingFixture(),
			await seedSpendingFixture(),
		];
		await addMoneyIn(b);
		await addRows(c, [
			{
				title: "Returned jacket",
				amount: 1_500,
				date: at("2026-03-25"),
				categoryId: c.groceries.id,
				direction: "IN",
				inType: "REFUND",
			},
			// Hidden from reports: reports skip it like a hidden expense.
			{
				title: "Hidden refund",
				amount: 1_000,
				date: at("2026-03-26"),
				categoryId: c.groceries.id,
				direction: "IN",
				inType: "REFUND",
				excludeFromAnalytics: true,
			},
		]);
		plain = await readAllSpendingReaders(a);
		withMoneyIn = await readAllSpendingReaders(b);
		withRefund = await readAllSpendingReaders(c);
	}, 120_000);
	afterAll(() => vi.useRealTimers());

	it("starts from the characterized numbers", () => {
		expect(plain).toMatchObject(EXPECTED_READINGS);
	});

	for (const reader of Object.keys(EXPECTED_READINGS).concat("listed")) {
		if (reader === "categories") continue;
		it(`leaves ${reader} unchanged with income, transfers and adjustments`, () => {
			expect(withMoneyIn[reader as keyof Readings]).toEqual(
				plain[reader as keyof Readings],
			);
		});
	}

	it("posts the sidecar row the way the Go job does", async () => {
		await expect(
			adminDb.expense.count({
				where: {
					pricingSource: "RECURRING",
					direction: "IN",
					inType: "INCOME",
				},
			}),
		).resolves.toBeGreaterThan(0);
	});

	it("adds only the income categories to the category list", () => {
		// Pickers filter by kind once the money-in screens land (2D/S4).
		expect([...withMoneyIn.categories].sort()).toEqual(
			[
				...plain.categories,
				"Freelance",
				"Gifts",
				"Interest",
				"Other income",
				"Salary",
				"Sales",
			].sort(),
		);
	});

	describe("a refund", () => {
		// March spending 422,000 less the 1,500 Groceries refund.
		const MARCH = 420_500;

		it("nets against spending in its month and category", () => {
			expect(withRefund).toMatchObject({
				spendingTotalMarch: MARCH,
				// The refund lowers the total but is not a transaction, as in totalEntries.
				lifetime: { totalSpent: 536_500, totalTransactions: 10 },
				profileLifetime: { lifetimeSpend: 536_500, totalEntries: 12 },
				runway: {
					averageMonthlySpend: 516_500 / (80 / 30.436875),
					monthsActive: 3,
				},
				// April, the running month, has no refund.
				spentFigure: EXPECTED_READINGS.spentFigure,
			});
		});

		it("is not listed by the screens that cannot label it yet", () => {
			expect(withRefund.listed).toEqual(EXPECTED_LISTED);
			expect(withRefund.csvLines).toBe(EXPECTED_READINGS.csvLines);
		});
	});
});

describe("a user with only money in", () => {
	beforeAll(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
	});
	afterAll(() => vi.useRealTimers());

	it("has no expenses: the lists stay empty", async () => {
		const { user } = await createTestUser();
		await adminDb.expense.createMany({
			data: [
				expenseData(user.id, {
					...MONEY_IN_PROBE,
					direction: "IN",
					inType: "INCOME",
				}),
				expenseData(user.id, {
					title: "Refund",
					amount: 500,
					date: at("2026-03-09"),
					direction: "IN",
					inType: "REFUND",
				}),
				expenseData(user.id, {
					title: "From savings",
					amount: 9_000,
					date: at("2026-03-09"),
					direction: "IN",
					entryKind: "NOT_SPENDING",
				}),
			],
		});
		await addSidecarIncome(user.id);
		const c = callers(user.id);

		await expect(c.expense.listFinalized()).resolves.toEqual([]);
		await expect(c.profile.getLifetimeStats()).resolves.toMatchObject({
			totalEntries: 0,
		});
	}, 60_000);
});
