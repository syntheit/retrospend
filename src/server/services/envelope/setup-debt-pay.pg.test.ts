/**
 * Setup with Pay off debt and the pay step on Postgres: one write creates the
 * book, saves the payoff plan on the new Extra debt payment envelope and keeps
 * how you are paid. USD book; a Visa owing 1,200.00 at 24% a year with a
 * minimum of 50.00, extra 100.00, avalanche. Expected values by hand:
 *
 *   The extra envelope's target becomes 100.00 a month, Set aside, and the
 *   plan row says 100.00, AVALANCHE, on that envelope.
 *   The first month ends at 1,200 + 24.00 interest - 50 - 100 = 1,074.00 (the
 *   plan screen's own first month, debts.pg.test.ts).
 *   At 2% a month with 150.00 paid, the balance is cleared in
 *   -ln(1 - 1,200 * 0.02 / 150) / ln(1.02) = 8.8 payments, so 9 months: the
 *   debt-free month is the 9th, 8 months after the first.
 *   Pay: monthly from Dec 5 gives the next pay Dec 5 while it is ahead of
 *   today; a varying pay has none.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { type SetupInput, setupInputSchema } from "~/lib/schemas/envelope";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { openAccount } from "../accounts/test-fixtures";
import { seedUser } from "./__tests__/pg-fixture";
import { addMonths } from "./calendar";
import { debtsApi } from "./debt-api.service";
import { setupEnvelopeBook } from "./setup.mutation";

type Seeded = Awaited<ReturnType<typeof seedUser>>;
const usd = (minor: number) => ({ minor, currency: "USD" });
const NEXT_YEAR = new Date().getUTCFullYear() + 1;

function input(s: Seeded, visa: string, extra = 10_000): SetupInput {
	return {
		style: "DEBT_PAYOFF",
		startingMoneyMinor: 100_000,
		groups: [
			{ key: "bills", name: "Bills", role: "BILLS" },
			{ key: "debts", name: "Debts", role: "BILLS" },
			{ key: "spending", name: "Spending", role: "SPENDING" },
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
				key: "spending",
				name: "Spending",
				groupKey: "spending",
				kind: "MONTHLY",
				isDefault: true,
				categoryIds: [],
			},
			{
				key: `debt-${visa}`,
				name: "Visa minimum",
				groupKey: "debts",
				kind: "BILL",
				isDefault: false,
				categoryIds: [],
				target: { kind: "BILL_LIABILITY", liabilityId: visa },
			},
			{
				key: "extra-debt",
				name: "Extra debt payment",
				groupKey: "debts",
				kind: "MONTHLY",
				isDefault: false,
				categoryIds: [],
				target: {
					kind: "MONTHLY",
					amountMinor: 0,
					mode: "SET_ASIDE",
					cadence: "MONTH",
				},
			},
		],
		payoff: {
			strategy: "AVALANCHE",
			extraMonthlyMinor: extra,
			envelopeKey: "extra-debt",
		},
	};
}

async function world() {
	const s = await seedUser();
	const visa = await openAccount(
		s.user.id,
		"Visa",
		"LIABILITY_CREDIT_CARD",
		"USD",
		1_200,
	);
	await debtsApi.setTerms(s.user.id, {
		assetAccountId: visa,
		aprPercent: "24",
		minimumMinor: 5_000,
		dueDay: 5,
	});
	return { ...s, visa };
}

describe("setup with Pay off debt", () => {
	let w: Awaited<ReturnType<typeof world>>;
	beforeAll(async () => {
		w = await world();
	});

	it("the preview writes nothing and says where the plan leads", async () => {
		const p = await forUser(w.user.id).preview(setupEnvelopeBook, {
			...input(w, w.visa),
			timeZone: "UTC",
		});
		expect(p.value.payoff).toMatchObject({
			debts: 1,
			diverges: false,
			incomplete: false,
		});
		expect(p.value.payoff?.debtFreeMonth).not.toBeNull();
		expect(
			await adminDb.budgetBook.count({ where: { createdById: w.user.id } }),
		).toBe(0);
	});

	it("one write: the book, the saved plan, the extra's target, the debt-free month", async () => {
		const r = await forUser(w.user.id).apply(setupEnvelopeBook, {
			...input(w, w.visa),
			pay: { frequency: "MONTHLY", nextPay: `${NEXT_YEAR}-12-05` },
			timeZone: "UTC",
		});
		const book = await adminDb.budgetBook.findFirstOrThrow({
			where: { createdById: w.user.id },
			include: { envelopes: true },
		});
		const extra = book.envelopes.find((e) => e.name === "Extra debt payment");
		expect(extra).toBeDefined();
		expect([extra?.targetAmount?.toString(), extra?.targetMode]).toEqual([
			"100",
			"SET_ASIDE",
		]);
		const plan = await adminDb.payoffPlan.findUniqueOrThrow({
			where: { bookId: book.id },
		});
		expect([
			plan.strategy,
			plan.extraMonthly.toString(),
			plan.envelopeId,
		]).toEqual(["AVALANCHE", "100", extra?.id]);

		const p = await debtsApi.project(w.user.id, {});
		expect(p.schedule[0]?.balances).toEqual([107_400]);
		expect(p.schedule).toHaveLength(9);
		const first = p.schedule[0]?.month as number;
		expect(p.debtFreeMonth).toBe(addMonths(first, 8));
		expect(r.value.payoff).toEqual({
			debtFreeMonth: p.debtFreeMonth,
			totalInterest: p.totalInterest,
			diverges: false,
			incomplete: false,
			debts: 1,
		});
		expect(r.value.payoff?.totalInterest.currency).toBe("USD");
		// The plan's cost counts the extra: Rent has no target, the Visa bill
		// follows its 50.00 minimum, the extra is 100.00.
		expect(r.value.plan?.cost).toEqual(usd(15_000));

		expect(r.value.nextPay).toBe(`${NEXT_YEAR}-12-05`);
		expect(book.payFrequency).toBe("MONTHLY");
		expect(book.payAnchor?.toISOString().slice(0, 10)).toBe(
			`${NEXT_YEAR}-12-05`,
		);
	});

	it("a varying pay keeps no date and the plan can be left out", async () => {
		const other = await world();
		const { payoff: _plan, ...rest } = input(other, other.visa);
		const r = await forUser(other.user.id).apply(setupEnvelopeBook, {
			...rest,
			pay: { frequency: "VARIES", nextPay: null },
			timeZone: "UTC",
		});
		expect(r.value.nextPay).toBeNull();
		expect(r.value.payoff).toBeNull();
		const book = await adminDb.budgetBook.findFirstOrThrow({
			where: { createdById: other.user.id },
		});
		expect([book.payFrequency, book.payAnchor]).toEqual(["VARIES", null]);
		expect(await adminDb.payoffPlan.count({ where: { bookId: book.id } })).toBe(
			0,
		);
	});

	it("refuses a plan for another style or an envelope that is not in the setup", () => {
		const base = input(w, w.visa);
		expect(setupInputSchema.safeParse(base).success).toBe(true);
		expect(setupInputSchema.safeParse({ ...base, style: "FLEX" }).success).toBe(
			false,
		);
		expect(
			setupInputSchema.safeParse({
				...base,
				payoff: { ...base.payoff, envelopeKey: "nope" },
			}).success,
		).toBe(false);
		expect(
			setupInputSchema.safeParse({
				...base,
				pay: { frequency: "WEEKLY", nextPay: null },
			}).success,
		).toBe(false);
	});
});
