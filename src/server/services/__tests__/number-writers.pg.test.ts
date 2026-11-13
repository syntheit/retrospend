/**
 * The writers that still receive a number (a typed rate, a budget, a split
 * amount) hand Postgres decimal text, rounded half to even at the column's
 * scale (columnFromFloat), where Prisma used to send the float and Postgres
 * rounded the tie away from zero. Every value is worked out by hand; the
 * home currency is ARS.
 *
 * - ARS per USD typed as 1450.1234565 into DECIMAL(18,6): the 7th decimal is
 *   a 5 after a 6 (even), so 1450.123456. Half up gave 1450.123457.
 * - 1450.1234575 after a 7 (odd): 1450.123458.
 * - Budget 0.123456785 into DECIMAL(19,8): 8 is even, so 0.12345678.
 *   0.123456795: 9 is odd, so 0.1234568.
 * - A shared expense of 0.123456785 USD into DECIMAL(19,8): 0.12345678.
 * - An EXACT share of 0.123456785 (8 even) is 0.12345678 and 0.116543215 (1
 *   odd) is 0.11654322; together 0.24 at the cent, as the amount.
 * - Percentages 12.34565 (6 even) and 87.65435 (3 odd) into DECIMAL(7,4):
 *   12.3456 and 87.6544.
 * - A KZT rate of 450.123456 is captured as is: no float noise.
 * - An undo writes a legacy ARS share of 10,333,333.33666667 (16 digits) back
 *   unchanged, and a rebalance of BRL 90 over four writes 22.5 four times
 *   (9000 cents / 4 = 2250).
 */
import { dayKey } from "@retrospend/domain/time-zone";
import { describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { createProject } from "../project/project-write.service";
import { SharedTransactionService } from "../shared-expenses/transaction.service";
import { openAccount, arsUser } from "../accounts/test-fixtures";
import { updateBalance } from "../accounts/update-balance.mutation";
import { updateSharedExpense } from "../entry/shared.mutation";
import { callerFor, seedTrip } from "../project/__tests__/trip-fixture";

describe("a typed custom rate on an account", () => {
	it("rounds half to even at six decimals when the account is opened and when its balance is updated", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Cash pesos", "CASH", "ARS", 1000, {
			exchangeRate: 1450.1234565,
			exchangeRateType: "custom",
		});
		const stored = async () =>
			(
				await adminDb.assetAccount.findUniqueOrThrow({ where: { id } })
			).exchangeRate?.toString();
		expect(await stored()).toBe("1450.123456");

		await forUser(user.id).apply(updateBalance, {
			accountId: id,
			balance: "1000",
			rateType: "custom",
			exchangeRate: 1450.1234575,
		});
		expect(await stored()).toBe("1450.123458");
	});
});

describe("a project budget", () => {
	it("rounds half to even at eight decimals", async () => {
		const { user } = await createTestUser();
		const make = (budgetAmount: number) =>
			createProject(
				adminDb,
				{ userId: user.id },
				{
					name: "Budget",
					budgetAmount,
					budgetCurrency: "USD",
					primaryCurrency: "USD",
					visibility: "PRIVATE",
					billingAutoClose: false,
					billingCloseReminderDays: 3,
					billingClosePermission: "ORGANIZER_ONLY",
				},
			);
		const budgetOf = async (budgetAmount: number) =>
			(
				await adminDb.project.findUniqueOrThrow({
					where: { id: (await make(budgetAmount)).id },
				})
			).budgetAmount?.toString();
		expect(await budgetOf(0.123456785)).toBe("0.12345678");
		expect(await budgetOf(0.123456795)).toBe("0.1234568");
	});
});

describe("a shared expense amount", () => {
	it("rounds half to even at eight decimals", async () => {
		const ana = await createTestUser();
		const ben = await createTestUser();
		const ref = (u: typeof ana) => ({
			participantType: "user" as const,
			participantId: u.user.id,
		});
		const created = await new SharedTransactionService(
			adminDb,
			ref(ana),
		).create({
			amount: 0.123456785,
			currency: "USD",
			description: "Tiny",
			date: new Date(),
			paidBy: ref(ana),
			splitWith: [ref(ana), ref(ben)],
			splitMode: "EQUAL",
		});
		const row = await adminDb.sharedTransaction.findUniqueOrThrow({
			where: { id: created.transaction.id },
		});
		expect(row.amount.toString()).toBe("0.12345678");
	});
});

describe("a shared expense's split and rate columns", () => {
	const ref = (u: Awaited<ReturnType<typeof createTestUser>>) => ({
		participantType: "user" as const,
		participantId: u.user.id,
	});
	const service = (u: Awaited<ReturnType<typeof createTestUser>>) =>
		new SharedTransactionService(adminDb, ref(u));
	const sharesOf = async (id: string) =>
		Object.fromEntries(
			(
				await adminDb.splitParticipant.findMany({
					where: { transactionId: id },
				})
			).map((r) => [r.participantId, r]),
		);

	it("rounds EXACT shares half to even at eight decimals", async () => {
		const ana = await createTestUser();
		const ben = await createTestUser();
		const created = await service(ana).create({
			amount: 0.24,
			currency: "USD",
			description: "Tiny",
			date: new Date(),
			paidBy: ref(ana),
			splitWith: [
				{ ...ref(ana), shareAmount: 0.123456785 },
				{ ...ref(ben), shareAmount: 0.116543215 },
			],
			splitMode: "EXACT",
		});
		const rows = await sharesOf(created.transaction.id);
		expect(rows[ana.user.id]?.shareAmount.toString()).toBe("0.12345678");
		expect(rows[ben.user.id]?.shareAmount.toString()).toBe("0.11654322");
	});

	it("rounds percentages half to even at four decimals", async () => {
		const ana = await createTestUser();
		const ben = await createTestUser();
		const created = await service(ana).create({
			amount: 100,
			currency: "USD",
			description: "Percent",
			date: new Date(),
			paidBy: ref(ana),
			splitWith: [
				{ ...ref(ana), sharePercentage: 12.34565 },
				{ ...ref(ben), sharePercentage: 87.65435 },
			],
			splitMode: "PERCENTAGE",
		});
		const rows = await sharesOf(created.transaction.id);
		expect(rows[ana.user.id]?.sharePercentage?.toString()).toBe("12.3456");
		expect(rows[ben.user.id]?.sharePercentage?.toString()).toBe("87.6544");
	});

	it("captures the table rate as it is stored", async () => {
		const today = new Date(`${dayKey(new Date())}T00:00:00.000Z`);
		await adminDb.exchangeRate.upsert({
			where: {
				date_currency_type: { date: today, currency: "KZT", type: "official" },
			},
			create: {
				date: today,
				currency: "KZT",
				type: "official",
				rate: "450.123456",
			},
			update: { rate: "450.123456" },
		});
		const ana = await createTestUser();
		const created = await service(ana).create({
			amount: 1000,
			currency: "KZT",
			description: "Tenge",
			date: new Date(),
			paidBy: ref(ana),
			splitWith: [ref(ana)],
			splitMode: "EQUAL",
		});
		const row = await adminDb.sharedTransaction.findUniqueOrThrow({
			where: { id: created.transaction.id },
		});
		expect(row.exchangeRate?.toString()).toBe("450.123456");
	});

	it("undo writes a legacy 16 digit share back unchanged", async () => {
		const ana = await createTestUser();
		const ben = await createTestUser();
		// ARS 20,666,666.68 in two shares of 10,333,333.33666667: 1033333334
		// cents each, 2066666668 together, as the amount.
		const legacy = await adminDb.sharedTransaction.create({
			data: {
				description: "Legacy",
				amount: "20666666.68",
				currency: "ARS",
				date: new Date("2026-10-08"),
				splitMode: "EXACT",
				paidByType: "user",
				paidById: ana.user.id,
				createdByType: "user",
				createdById: ana.user.id,
				splitParticipants: {
					create: [ana, ben].map((u) => ({
						...ref(u),
						shareAmount: "10333333.33666667",
						verificationStatus: "ACCEPTED" as const,
					})),
				},
			},
		});
		const edited = await forUser(ana.user.id).apply(updateSharedExpense, {
			id: legacy.id,
			description: "Edited",
		});
		await forUser(ana.user.id).apply(updateSharedExpense, {
			...edited.value.restore,
		});
		const row = await adminDb.sharedTransaction.findUniqueOrThrow({
			where: { id: legacy.id },
		});
		expect(row.description).toBe("Legacy");
		expect(row.amount.toString()).toBe("20666666.68");
		const rows = await sharesOf(legacy.id);
		expect(rows[ana.user.id]?.shareAmount.toString()).toBe("10333333.33666667");
		expect(rows[ben.user.id]?.shareAmount.toString()).toBe("10333333.33666667");
	});

	it("a rebalance writes the new equal shares as exact text", async () => {
		const trip = await seedTrip();
		await callerFor(trip.ana.user).addParticipant({
			projectId: trip.project.id,
			participantType: "user",
			participantId: trip.outsider.user.id,
		});
		const done = await callerFor(trip.ana.user).rebalanceExpenses({
			projectId: trip.project.id,
			participantType: "user",
			participantId: trip.outsider.user.id,
			expenseIds: [trip.expenses.car.id],
		});
		expect(done.rebalancedIds).toEqual([trip.expenses.car.id]);
		const rows = await adminDb.splitParticipant.findMany({
			where: { transactionId: trip.expenses.car.id },
		});
		// BRL 90 over four: 9000 cents / 4 = 2250 each.
		expect(rows.map((r) => r.shareAmount.toString())).toEqual([
			"22.5",
			"22.5",
			"22.5",
			"22.5",
		]);
	});
});
