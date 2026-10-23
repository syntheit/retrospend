/**
 * One spending ledger for the pg tests that pin every spending reader
 * (spending-readers.pg.test.ts) and prove money in never leaks into them
 * (money-in-leak.pg.test.ts).
 *
 * Home currency ARS, one blue rate of ARS 1,000 per USD for every date,
 * fiscal months start on the 1st, all dates in UTC. "Now" is 2026-04-10
 * 12:00 UTC, so March is a closed month and April is running.
 * Rates are global and the pg files share one database: another file that
 * stores an ARS rate dated before "now" moves the USD row's conversion, so
 * other files use their own currencies (UYU, ZZB and so on).
 *
 * Counted rows (your spending):
 *   Jan 20   Groceries      ARS  30,000
 *   Feb  3   Groceries      ARS  20,000
 *   Feb 15   (no category)  ARS  40,000  amortized part 1/3 of ARS 120,000
 *   Mar  1   Rent (fixed)   ARS 300,000
 *   Mar  5   Groceries      ARS  12,000
 *   Mar 10   Groceries      USD      50  (= ARS 50,000)
 *   Mar 15   (no category)  ARS  40,000  amortized part 2/3
 *   Mar 20   Bob's dinner   ARS  20,000  your share of ARS 60,000 (Bob paid)
 *   Apr  5   Groceries      ARS   1,000
 *   Apr 10   Groceries      ARS   5,000  (02:00, inside the last 24 hours)
 *   Apr 15   (no category)  ARS  40,000  amortized part 3/3, after "now"
 * Rows that never count:
 *   Mar 12   Groceries      ARS   7,000  hidden from reports
 *   Mar 18   Groceries      ARS   9,000  draft
 *   Feb 15   parent of the amortized parts (ARS 120,000)
 *   Mar 21   ARS 4,000 share you rejected
 *   Mar 22   ARS 8,000 share in a project you hide from analytics
 * Budgets for March: Groceries ARS 100,000, Rent ARS 300,000.
 */
import { randomUUID } from "node:crypto";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { Prisma } from "~prisma";

export const NOW = new Date("2026-04-10T12:00:00.000Z");
export const MARCH = new Date("2026-03-15T12:00:00.000Z");
export const APRIL = new Date("2026-04-10T12:00:00.000Z");
export const HOME = "ARS";
export const TZ = "UTC";

// Budget periods are keyed by the server-local first of the month, as the app writes them.
const MARCH_PERIOD = new Date(2026, 2, 1);

export const at = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

export type SpendingFixture = Awaited<ReturnType<typeof seedSpendingFixture>>;

async function seedRates() {
	await adminDb.exchangeRate.createMany({
		data: [
			{
				date: new Date("2025-01-01T00:00:00.000Z"),
				currency: "ARS",
				type: "blue",
				rate: 1000,
			},
		],
		skipDuplicates: true,
	});
}

export type Row = {
	title: string;
	amount: number;
	currency?: string;
	date: Date;
	categoryId?: string | null;
	status?: "DRAFT" | "FINALIZED";
	excludeFromAnalytics?: boolean;
	isAmortizedParent?: boolean;
	isAmortizedChild?: boolean;
	parentId?: string;
	id?: string;
	// Money in (M1); spending rows leave them at their defaults.
	direction?: "OUT" | "IN";
	entryKind?: "STANDARD" | "STARTING_BALANCE" | "ADJUSTMENT" | "NOT_SPENDING";
	inType?: "INCOME" | "REFUND";
	amortizeMode?: "INSTALLMENTS" | "REPORTS_ONLY";
};

export function expenseData(userId: string, row: Row) {
	const currency = row.currency ?? HOME;
	const rate = currency === "USD" ? 1 : 1000;
	return {
		id: row.id ?? randomUUID(),
		userId,
		title: row.title,
		amount: new Prisma.Decimal(row.amount),
		currency,
		date: row.date,
		categoryId: row.categoryId ?? null,
		amountInUSD: new Prisma.Decimal(row.amount / rate),
		exchangeRate: new Prisma.Decimal(rate),
		pricingSource: "MANUAL",
		status: row.status ?? "FINALIZED",
		excludeFromAnalytics: row.excludeFromAnalytics ?? false,
		isAmortizedParent: row.isAmortizedParent ?? false,
		isAmortizedChild: row.isAmortizedChild ?? false,
		parentId: row.parentId ?? null,
		...(row.direction ? { direction: row.direction } : {}),
		...(row.entryKind ? { entryKind: row.entryKind } : {}),
		...(row.inType ? { inType: row.inType } : {}),
		...(row.amortizeMode ? { amortizeMode: row.amortizeMode } : {}),
	};
}

export async function seedSpendingFixture() {
	await seedRates();
	const { user, db } = await createTestUser();
	const { user: bob } = await createTestUser();
	const userId = user.id;
	await adminDb.user.update({
		where: { id: userId },
		data: {
			homeCurrency: HOME,
			monthlyIncome: new Prisma.Decimal(1000),
			monthlyIncomeCurrency: "USD",
		},
	});

	const groceries = await adminDb.category.create({
		data: { name: "Groceries", color: "emerald", userId },
	});
	const rent = await adminDb.category.create({
		data: { name: "Rent", color: "blue", userId, isFixed: true },
	});
	const bobFood = await adminDb.category.create({
		data: { name: "Food", color: "amber", userId: bob.id },
	});

	const parentId = randomUUID();
	const rows: Row[] = [
		{
			title: "Super Jan",
			amount: 30_000,
			date: at("2026-01-20"),
			categoryId: groceries.id,
		},
		{
			title: "Super Feb",
			amount: 20_000,
			date: at("2026-02-03"),
			categoryId: groceries.id,
		},
		{
			title: "Rent March",
			amount: 300_000,
			date: at("2026-03-01"),
			categoryId: rent.id,
		},
		{
			title: "Super Mar",
			amount: 12_000,
			date: at("2026-03-05"),
			categoryId: groceries.id,
		},
		{
			title: "Imported snacks",
			amount: 50,
			currency: "USD",
			date: at("2026-03-10"),
			categoryId: groceries.id,
		},
		{
			title: "Hidden",
			amount: 7_000,
			date: at("2026-03-12"),
			categoryId: groceries.id,
			excludeFromAnalytics: true,
		},
		{
			title: "Draft",
			amount: 9_000,
			date: at("2026-03-18"),
			categoryId: groceries.id,
			status: "DRAFT",
		},
		{
			title: "Super Apr",
			amount: 1_000,
			date: at("2026-04-05"),
			categoryId: groceries.id,
		},
		{
			title: "Kiosk",
			amount: 5_000,
			date: new Date("2026-04-10T02:00:00.000Z"),
			categoryId: groceries.id,
		},
		{
			id: parentId,
			title: "Laptop",
			amount: 120_000,
			date: at("2026-02-15"),
			isAmortizedParent: true,
		},
	];
	await adminDb.expense.createMany({
		data: rows.map((r) => expenseData(userId, r)),
	});
	await adminDb.expense.createMany({
		data: ["2026-02-15", "2026-03-15", "2026-04-15"].map((day, i) =>
			expenseData(userId, {
				title: `Laptop (${i + 1}/3)`,
				amount: 40_000,
				date: at(day),
				isAmortizedChild: true,
				parentId,
			}),
		),
	});

	await adminDb.budget.createMany({
		data: [
			{
				userId,
				categoryId: groceries.id,
				amount: 100_000,
				currency: HOME,
				period: MARCH_PERIOD,
			},
			{
				userId,
				categoryId: rent.id,
				amount: 300_000,
				currency: HOME,
				period: MARCH_PERIOD,
			},
		],
	});

	const hiddenProject = await adminDb.project.create({
		data: {
			name: "Trip",
			createdById: bob.id,
			primaryCurrency: HOME,
			participants: {
				create: [
					{ participantType: "user", participantId: bob.id, role: "ORGANIZER" },
					{
						participantType: "user",
						participantId: userId,
						excludeFromAnalytics: true,
					},
				],
			},
		},
	});

	const shared = async (
		description: string,
		day: string,
		myShare: number,
		options: { status?: "ACCEPTED" | "REJECTED"; projectId?: string } = {},
	) =>
		adminDb.sharedTransaction.create({
			data: {
				description,
				amount: myShare * 3,
				currency: HOME,
				date: at(day),
				categoryId: bobFood.id,
				exchangeRate: 1000,
				paidByType: "user",
				paidById: bob.id,
				createdByType: "user",
				createdById: bob.id,
				projectId: options.projectId ?? null,
				splitParticipants: {
					create: [
						{
							participantType: "user",
							participantId: bob.id,
							shareAmount: myShare * 2,
							verificationStatus: "ACCEPTED",
						},
						{
							participantType: "user",
							participantId: userId,
							shareAmount: myShare,
							verificationStatus: options.status ?? "ACCEPTED",
						},
					],
				},
			},
		});
	await shared("Dinner", "2026-03-20", 20_000);
	await shared("Rejected taxi", "2026-03-21", 4_000, { status: "REJECTED" });
	await shared("Trip hotel", "2026-03-22", 8_000, {
		projectId: hiddenProject.id,
	});

	return { user, userId, db, bob, groceries, rent };
}
