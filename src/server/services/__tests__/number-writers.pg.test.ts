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
 */
import { describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { createProject } from "../project/project-write.service";
import { SharedTransactionService } from "../shared-expenses/transaction.service";
import { openAccount, arsUser } from "../accounts/test-fixtures";
import { updateBalance } from "../accounts/update-balance.mutation";

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
			createProject(adminDb, { userId: user.id }, {
				name: "Budget",
				budgetAmount,
				budgetCurrency: "USD",
				primaryCurrency: "USD",
				visibility: "PRIVATE",
				billingAutoClose: false,
				billingCloseReminderDays: 3,
				billingClosePermission: "ORGANIZER_ONLY",
			});
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
		const created = await new SharedTransactionService(adminDb, ref(ana)).create({
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
