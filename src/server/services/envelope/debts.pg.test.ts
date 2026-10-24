/**
 * Debts on Postgres (02 §8 P6, SPEC §5.11, S14, B11). USD book: starting
 * money 1,000.00 (To assign 100,000); a "Pay down Visa" goal gets 300.00;
 * Checking 5,000.00 and a Visa card owing 1,200.00 (both part of the
 * budget, D3). Fees is a category no envelope links, so it lands in the
 * default envelope, Spending. Expected values by hand:
 *
 *   S14: he pays 1,400.00; 1,178.00 was new spending (never recorded), so
 *   the sheet records 200.00 toward the old balance and 22.00 interest.
 *   Visa owes 1,000.00; Checking 5,000 - 200 - 22 = 4,778.00. Pay down Visa:
 *   assigned 30,000, activity -20,000 principal - 2,200 interest (charged to
 *   the paying envelope; Fees stays its report category), Left 7,800; goal
 *   progress = Left + moved to Wealth = 27,800. Spending untouched.
 *   Rent and Dining untouched; To assign 70,000 before and after. The
 *   preview writes nothing; the undo puts every number back.
 *   B11: 600.00 paid, 400.00 covered new spending: only 200.00 is recorded,
 *   from Not tracked, no interest. Visa 1,000.00; one TO_WEALTH of 20,000.
 *   A loan (outside the budget) paid 300.00 + 50.00 interest from Checking:
 *   the transfer itself writes its one budget side.
 *   The plan: Visa 24% APR, minimum 50.00, extra 100.00, avalanche; first
 *   month 1,200 + 24.00 - 50 - 100 = 1,074.00. A debt in a currency with no
 *   rate is left out and listed, never valued at 1.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { SetupInput } from "~/lib/schemas/envelope";
import { userTransaction } from "~/server/db-tx";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { openAccount } from "../accounts/test-fixtures";
import { budgetItems } from "../needs-you/budget";
import { deleteTransfer } from "../transfers/delete.mutation";
import { invariantAt, seedUser } from "./__tests__/pg-fixture";
import { recordDebtPaymentMutation } from "./debt.mutation";
import { debtsApi } from "./debt-api.service";
import { assignEnvelopes } from "./movement.mutation";
import { getMonth } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";

type Seeded = Awaited<ReturnType<typeof seedUser>>;
const usd = (minor: number) => ({ minor, currency: "USD" });

function input(s: Seeded, visaBill?: string): SetupInput {
	return {
		style: "FLEX",
		startingMoneyMinor: 100_000,
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
				kind: "MONTHLY",
				isDefault: false,
				categoryIds: [s.rent],
			},
			{
				key: "dining",
				name: "Dining",
				groupKey: "spending",
				kind: "MONTHLY",
				isDefault: false,
				categoryIds: [s.dining],
			},
			{
				key: "spending",
				name: "Spending",
				groupKey: "spending",
				kind: "MONTHLY",
				isDefault: true,
				categoryIds: [],
			},
			{
				key: "visa",
				name: "Pay down Visa",
				groupKey: "savings",
				kind: "SAVINGS",
				isDefault: false,
				categoryIds: [],
				target: { kind: "SAVINGS", amountMinor: 120_000 },
			},
			...(visaBill
				? [
						{
							key: "visa-min",
							name: "Visa minimum",
							groupKey: "bills",
							kind: "BILL" as const,
							isDefault: false,
							categoryIds: [],
							target: {
								kind: "BILL_LIABILITY" as const,
								liabilityId: visaBill,
							},
						},
					]
				: []),
		],
	};
}

async function world(o: { bill?: boolean } = {}) {
	const s = await seedUser();
	await adminDb.category.create({
		data: { name: "Fees", color: "red", userId: s.user.id },
	});
	const checking = await openAccount(
		s.user.id,
		"Checking",
		"CASH",
		"USD",
		5_000,
	);
	const visa = await openAccount(
		s.user.id,
		"Visa",
		"LIABILITY_CREDIT_CARD",
		"USD",
		1_200,
	);
	const loan = await openAccount(
		s.user.id,
		"Loan",
		"LIABILITY_LOAN",
		"USD",
		10_000,
	);
	await debtsApi.setTerms(s.user.id, {
		assetAccountId: visa,
		aprPercent: "24",
		minimumMinor: 5_000,
		dueDay: Number(new Date().toISOString().slice(8, 10)),
	});
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...input(s, o.bill ? visa : undefined),
		timeZone: "UTC",
	});
	const book = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: s.user.id },
		include: { envelopes: true },
	});
	const id = (n: string) =>
		book.envelopes.find((e) => e.name === n)?.id as string;
	const month = (await getMonth(s.user.id))?.month.key as number;
	await forUser(s.user.id).apply(assignEnvelopes, {
		batchId: randomUUID(),
		month,
		mode: "add",
		items: [
			{
				id: randomUUID(),
				envelopeId: id("Pay down Visa"),
				amountMinor: 30_000,
			},
		],
	});
	return { ...s, checking, visa, loan, id, month };
}

const balance = async (id: string) =>
	(
		await adminDb.assetAccount.findUniqueOrThrow({ where: { id } })
	).balance.toString();
const rowOf = (m: Awaited<ReturnType<typeof getMonth>>, id: string) =>
	m?.groups.flatMap((g) => g.envelopes).find((e) => e.id === id);

describe("S14 a card payment with old debt and interest", () => {
	let w: Awaited<ReturnType<typeof world>>;
	let payment: Parameters<typeof recordDebtPaymentMutation.run>[1];

	beforeAll(async () => {
		w = await world();
		payment = {
			id: randomUUID(),
			liabilityId: w.visa,
			fromAccountId: w.checking,
			envelopeId: w.id("Pay down Visa"),
			principalMinor: 20_000,
			interestMinor: 2_200,
		};
	});

	it("the preview writes nothing", async () => {
		const before = await adminDb.transfer.count({
			where: { userId: w.user.id },
		});
		const p = await forUser(w.user.id).preview(
			recordDebtPaymentMutation,
			payment,
		);
		expect(p.value.balance).toEqual({
			before: usd(120_000),
			after: usd(100_000),
		});
		await expect(
			adminDb.transfer.count({ where: { userId: w.user.id } }),
		).resolves.toBe(before);
		expect(await balance(w.visa)).toBe("1200");
	});

	it("principal leaves Pay down Visa, interest is Fees spending, nothing else moves", async () => {
		const before = await getMonth(w.user.id);
		const r = await forUser(w.user.id).apply(
			recordDebtPaymentMutation,
			payment,
		);
		expect(r.undo).toMatchObject({ mutation: "transfer.delete" });
		expect(r.value.wealthTransferId).not.toBeNull();
		expect(await balance(w.visa)).toBe("1000");
		expect(await balance(w.checking)).toBe("4778");
		const m = await getMonth(w.user.id);
		const visa = rowOf(m, w.id("Pay down Visa"));
		expect([
			visa?.assigned.minor,
			visa?.activity.minor,
			visa?.left.minor,
		]).toEqual([30_000, -22_200, 7_800]);
		expect(visa?.target?.progress).toEqual(usd(27_800));
		expect(rowOf(m, w.id("Spending"))?.activity).toEqual(usd(0));
		expect(rowOf(m, w.id("Rent"))).toEqual(rowOf(before, w.id("Rent")));
		expect(rowOf(m, w.id("Dining"))).toEqual(rowOf(before, w.id("Dining")));
		expect(m?.toAssign.amount).toEqual(usd(70_000));
		const sides = await invariantAt(w.user.id);
		expect(sides.budget).toBe(sides.ledger);
	});

	it("a retry with the same id writes nothing more", async () => {
		await forUser(w.user.id).apply(recordDebtPaymentMutation, payment);
		await expect(
			adminDb.transfer.count({ where: { userId: w.user.id } }),
		).resolves.toBe(1);
		expect(await balance(w.visa)).toBe("1000");
	});

	it("the undo puts every number back", async () => {
		await forUser(w.user.id).apply(deleteTransfer, { transferId: payment.id });
		expect(await balance(w.visa)).toBe("1200");
		expect(await balance(w.checking)).toBe("5000");
		const m = await getMonth(w.user.id);
		expect(rowOf(m, w.id("Pay down Visa"))?.left).toEqual(usd(30_000));
		expect(rowOf(m, w.id("Spending"))?.activity).toEqual(usd(0));
		await expect(
			adminDb.wealthTransfer.count({ where: { transferId: payment.id } }),
		).resolves.toBe(0);
	});
});

describe("B11 and a loan", () => {
	it("B11: only the old-debt 200.00 is recorded, from Not tracked", async () => {
		const w = await world();
		const id = randomUUID();
		await forUser(w.user.id).apply(recordDebtPaymentMutation, {
			id,
			liabilityId: w.visa,
			fromAccountId: null,
			envelopeId: w.id("Pay down Visa"),
			principalMinor: 20_000,
			interestMinor: 0,
		});
		expect(await balance(w.visa)).toBe("1000");
		const sides = await adminDb.wealthTransfer.findMany({
			where: { transferId: id },
		});
		expect(sides.map((x) => [x.direction, Number(x.amount)])).toEqual([
			["TO_WEALTH", 200],
		]);
		expect((await getMonth(w.user.id))?.toAssign.amount).toEqual(usd(70_000));
	});

	it("a loan outside the budget: the transfer writes its one budget side", async () => {
		const w = await world();
		const id = randomUUID();
		await forUser(w.user.id).apply(recordDebtPaymentMutation, {
			id,
			liabilityId: w.loan,
			fromAccountId: w.checking,
			envelopeId: w.id("Pay down Visa"),
			principalMinor: 30_000,
			interestMinor: 5_000,
		});
		expect(await balance(w.loan)).toBe("9700");
		expect(await balance(w.checking)).toBe("4650");
		await expect(
			adminDb.wealthTransfer.count({ where: { transferId: id } }),
		).resolves.toBe(1);
		const sides = await invariantAt(w.user.id);
		expect(sides.budget).toBe(sides.ledger);
	});
});

/**
 * Review round 1.
 *   From Brokerage (outside the budget) to the Loan: 300.00 + 50.00. Wealth
 *   only: Loan 9,700.00, Brokerage 4,650.00; no envelope moves (Pay down
 *   Visa stays 30,000), To assign stays 70,000, the interest is not budget
 *   spending.
 *   The Visa minimum (50.00) paid as 26.00 principal + 24.00 interest from
 *   Spending: Debt payment due clears; Spending activity -5,000; the bill
 *   envelope keeps what it had.
 *   Principal above what is owed (1,300.00 of 1,200.00) is refused.
 */
describe("payments outside the budget, any-envelope minimums, caps (review round 1)", () => {
	it("from an account outside the budget: Wealth only, no envelope, no budget spending", async () => {
		const w = await world();
		const brokerage = await openAccount(
			w.user.id,
			"Brokerage",
			"INVESTMENT",
			"USD",
			5_000,
		);
		const id = randomUUID();
		await forUser(w.user.id).apply(recordDebtPaymentMutation, {
			id,
			liabilityId: w.loan,
			fromAccountId: brokerage,
			envelopeId: w.id("Pay down Visa"),
			principalMinor: 30_000,
			interestMinor: 5_000,
		});
		expect(await balance(w.loan)).toBe("9700");
		expect(await balance(brokerage)).toBe("4650");
		await expect(
			adminDb.wealthTransfer.count({ where: { transferId: id } }),
		).resolves.toBe(0);
		const m = await getMonth(w.user.id);
		expect(rowOf(m, w.id("Pay down Visa"))?.left).toEqual(usd(30_000));
		expect(rowOf(m, w.id("Spending"))?.activity).toEqual(usd(0));
		expect(m?.toAssign.amount).toEqual(usd(70_000));
		const sides = await invariantAt(w.user.id);
		expect(sides.budget).toBe(sides.ledger);
	});

	it("a minimum paid as principal plus interest from any envelope clears Debt payment due", async () => {
		const w = await world({ bill: true });
		const due = async () => {
			const m = await getMonth(w.user.id);
			return budgetItems({
				dto: m as NonNullable<typeof m>,
				paused: false,
				startingMoneyUnconfirmed: false,
				moneyIn: [],
			}).filter((i) => i.type === "budget.debtDue");
		};
		expect(await due()).toHaveLength(1);
		const bill = rowOf(await getMonth(w.user.id), w.id("Visa minimum"));
		await forUser(w.user.id).apply(recordDebtPaymentMutation, {
			id: randomUUID(),
			liabilityId: w.visa,
			fromAccountId: w.checking,
			envelopeId: w.id("Spending"),
			principalMinor: 2_600,
			interestMinor: 2_400,
		});
		expect(await due()).toEqual([]);
		const m = await getMonth(w.user.id);
		expect(rowOf(m, w.id("Spending"))?.activity).toEqual(usd(-5_000));
		expect(rowOf(m, w.id("Visa minimum"))?.left).toEqual(bill?.left);
	});

	it("refuses principal above what is owed", async () => {
		const w = await world();
		await expect(
			forUser(w.user.id).apply(recordDebtPaymentMutation, {
				id: randomUUID(),
				liabilityId: w.visa,
				fromAccountId: w.checking,
				envelopeId: null,
				principalMinor: 130_000,
				interestMinor: 0,
			}),
		).rejects.toThrow(/more than you owe/);
	});

	it("undo of a saved plan restores the envelope's target exactly", async () => {
		const w = await world();
		// Rent has no target before; the plan gives it Set aside 100.00.
		const extra = w.id("Rent");
		await debtsApi.savePlan(w.user.id, {
			strategy: "AVALANCHE",
			extraMonthlyMinor: 10_000,
			customOrder: [],
			envelopeId: extra,
		});
		const before = await adminDb.envelope.findUniqueOrThrow({
			where: { id: extra },
		});
		expect([before.targetAmount?.toString(), before.targetMode]).toEqual([
			"100",
			"SET_ASIDE",
		]);
		await debtsApi.revertPlan(w.user.id);
		const after = await adminDb.envelope.findUniqueOrThrow({
			where: { id: extra },
		});
		expect([
			after.targetAmount,
			after.targetMode,
			after.targetStartMonth,
		]).toEqual([null, "REFILL", before.targetStartMonth]);
		await expect(debtsApi.plan(w.user.id)).resolves.toMatchObject({
			extraMonthly: usd(0),
			envelopeId: null,
		});
	});
});

describe("a bill that follows the Visa minimum, and Debt payment due", () => {
	it("the bill needs 5,000 due today; Needs you asks to record it until it is paid", async () => {
		const w = await world({ bill: true });
		const m = await getMonth(w.user.id);
		const bill = rowOf(m, w.id("Visa minimum"));
		expect(bill?.target).toMatchObject({
			kind: "BILL",
			amount: usd(5_000),
			dueDate: m?.today,
			liabilityId: w.visa,
		});
		const items = (dto: NonNullable<typeof m>) =>
			budgetItems({
				dto,
				paused: false,
				startingMoneyUnconfirmed: false,
				moneyIn: [],
			}).filter((i) => i.type === "budget.debtDue");
		expect(items(m as NonNullable<typeof m>).map((i) => i.amount)).toEqual([
			usd(5_000),
		]);
		await forUser(w.user.id).apply(assignEnvelopes, {
			batchId: randomUUID(),
			month: w.month,
			mode: "add",
			items: [
				{
					id: randomUUID(),
					envelopeId: w.id("Visa minimum"),
					amountMinor: 5_000,
				},
			],
		});
		await forUser(w.user.id).apply(recordDebtPaymentMutation, {
			id: randomUUID(),
			liabilityId: w.visa,
			fromAccountId: w.checking,
			envelopeId: w.id("Visa minimum"),
			principalMinor: 5_000,
			interestMinor: 0,
		});
		const after = await getMonth(w.user.id);
		expect(items(after as NonNullable<typeof after>)).toEqual([]);
	});
});

describe("figure budget.totalDebt", () => {
	it("the plan: first month 1,074.00; the extra goes to its envelope's target; a rateless debt is listed, not valued", async () => {
		const w = await world();
		await adminDb.assetAccount.update({
			where: { id: w.loan },
			data: { closedAt: new Date() },
		});
		const extra = w.id("Spending");
		const saved = await debtsApi.savePlan(w.user.id, {
			strategy: "AVALANCHE",
			extraMonthlyMinor: 10_000,
			customOrder: [],
			envelopeId: extra,
		});
		expect(saved.previous).toBeNull();
		const env = await adminDb.envelope.findUniqueOrThrow({
			where: { id: extra },
		});
		expect([env.targetAmount?.toString(), env.targetMode]).toEqual([
			"100",
			"SET_ASIDE",
		]);
		const p = await debtsApi.project(w.user.id, {});
		expect(p.schedule[0]?.balances).toEqual([107_400]);
		expect(p.totalDebt).toEqual(usd(120_000));
		expect(p.debtFreeMonth).not.toBeNull();
		// The account service refuses a currency with no rate, so it is written directly.
		await adminDb.assetAccount.create({
			data: {
				userId: w.user.id,
				name: "Odd",
				type: "LIABILITY_LOAN",
				currency: "XTS",
				balance: 100,
			},
		});
		const q = await debtsApi.project(w.user.id, {});
		expect(q.missingRates).toEqual([
			expect.objectContaining({ currency: "XTS" }),
		]);
		expect(q.incomplete).toBe(true);
		expect(q.totalDebt).toEqual(usd(120_000));
	});

	it("terms come back with what they were; another user sees no plan (RLS)", async () => {
		const w = await world();
		const r = await debtsApi.setTerms(w.user.id, {
			assetAccountId: w.visa,
			aprPercent: "19.9",
			minimumMinor: 4_000,
			dueDay: 5,
		});
		expect(r.previous).toMatchObject({ aprPercent: "24", minimum: usd(5_000) });
		expect(r.terms).toMatchObject({
			aprPercent: "19.9",
			minimum: usd(4_000),
			dueDay: 5,
		});
		await debtsApi.savePlan(w.user.id, {
			strategy: "SNOWBALL",
			extraMonthlyMinor: 0,
			customOrder: [],
			envelopeId: null,
		});
		const bob = await seedUser();
		const book = await adminDb.budgetBook.findFirstOrThrow({
			where: { createdById: w.user.id },
		});
		await expect(
			bob.db.payoffPlan.findMany({ where: { bookId: book.id } }),
		).resolves.toEqual([]);
		await expect(
			userTransaction(adminDb, w.user.id, (tx) =>
				tx.payoffPlan.count({ where: { bookId: book.id } }),
			),
		).resolves.toBe(1);
	});
});
