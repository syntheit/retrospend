/**
 * S12 and goal progress with Wealth on Postgres (D24, D47, D50, SPEC §5.4,
 * §5.11). USD Flex book, cents, this month. Expected values by hand:
 *
 *   start money 100,000; a Vacation goal of 1,000.00 (amount only) gets
 *   50,000: To assign 50,000.
 *   S12: 300.00 bought into Wealth from Vacation: Vacation Left 20,000,
 *   its progress still 50,000 (20,000 + 30,000 moved); To assign 50,000.
 *   100.00 moved from Wealth straight into Dining: Dining Left 10,000; To
 *   assign still 50,000. Budget 50,000 + 20,000 + 10,000 = 80,000 =
 *   100,000 - 30,000 + 10,000.
 *   Linked to a cash account "Only for this goal" holding 400.00: progress
 *   = Left 20,000 + 40,000 = 60,000 (the account replaces the moves).
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { forUser } from "~/server/services/preview";
import { recordBudgetSide } from "~/server/services/transfers/budget-side";
import { adminDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { invariantAt, seedUser, setupInput } from "./__tests__/pg-fixture";
import { budgetMonthOf, isoDateIn } from "./months";
import { getMonth } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";

const usd = (minor: number) => ({ minor, currency: "USD" });
const current = budgetMonthOf(isoDateIn(new Date(), "UTC"), [
	{ fromMonth: 0, startDay: 1 },
]);

const row = (m: Awaited<ReturnType<typeof getMonth>>, id: string) =>
	m?.groups.flatMap((g) => g.envelopes).find((e) => e.id === id);

describe("S12 Wealth moves both ways and goal progress", () => {
	it("buying USD from a goal keeps its progress; money from Wealth can land in an envelope; a dedicated account replaces the moves", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			timeZone: "UTC",
		});
		const book = await adminDb.budgetBook.findFirstOrThrow({
			where: { createdById: s.user.id },
			include: { envelopes: true },
		});
		const dining = book.envelopes.find((e) => e.name === "Dining")
			?.id as string;
		const vacation = await adminDb.envelope.create({
			data: {
				bookId: book.id,
				name: "Vacation",
				kind: "SAVINGS",
				sortOrder: 9,
				targetAmount: new Prisma.Decimal(1000),
				targetStartMonth: current,
			},
		});
		await adminDb.budgetMovement.create({
			data: {
				id: randomUUID(),
				bookId: book.id,
				month: current,
				toEnvelopeId: vacation.id,
				amount: 500,
				kind: "ASSIGN",
				actorUserId: s.user.id,
			},
		});
		const move = (
			direction: "TO_WEALTH" | "FROM_WEALTH",
			minor: number,
			envelopeId: string,
		) =>
			userTransaction(adminDb, s.user.id, (tx) =>
				recordBudgetSide(tx, {
					userId: s.user.id,
					direction,
					amount: usd(minor),
					envelopeId,
					date: new Date(),
					transferId: null,
					countOnly: false,
					sourceExpenseId: null,
					assetAccountId: null,
				}),
			);
		await move("TO_WEALTH", 30_000, vacation.id);
		await move("FROM_WEALTH", 10_000, dining);
		const m = await getMonth(s.user.id);
		expect(row(m, vacation.id)).toMatchObject({
			left: usd(20_000),
			target: { kind: "SAVINGS", progress: usd(50_000) },
		});
		expect(row(m, dining)?.left).toEqual(usd(10_000));
		expect(m?.toAssign.amount).toEqual(usd(50_000));
		await expect(invariantAt(s.user.id)).resolves.toEqual({
			budget: 80_000,
			ledger: 80_000,
		});
		const cash = await adminDb.assetAccount.create({
			data: {
				userId: s.user.id,
				name: "Vacation cash",
				type: "CASH",
				currency: "USD",
				balance: new Prisma.Decimal(400),
			},
		});
		await adminDb.envelope.update({
			where: { id: vacation.id },
			data: { wealthAccountId: cash.id, wealthDedicated: true },
		});
		const linked = await getMonth(s.user.id);
		expect(row(linked, vacation.id)?.target?.progress).toEqual(usd(60_000));
		expect(linked?.incomplete).toBe(false);
	});
});
