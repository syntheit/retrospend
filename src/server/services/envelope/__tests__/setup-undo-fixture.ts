/**
 * Shared pieces of the set-up undo pg tests: users with a book, the inputs of
 * the styles, and counts read straight from the tables (never from the code
 * under test) so a test can say what a book holds before and after.
 */
import type { SetupInput } from "~/lib/schemas/envelope";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { seedArsRates } from "../../accounts/test-fixtures";
import { setupEnvelopeBook } from "../setup.mutation";
import { undoSetupEnvelopeBook } from "../setup-undo.mutation";
import { seedUser, setupInput } from "./pg-fixture";

export type Seeded = Awaited<ReturnType<typeof seedUser>>;

/** An ARS home currency with the blue rate as the favorite: ARS books value at blue. */
export async function arsBlueUser(): Promise<Seeded> {
	const s = await seedUser();
	await adminDb.user.update({
		where: { id: s.user.id },
		data: { homeCurrency: "ARS", timeZone: "UTC" },
	});
	await seedArsRates();
	const blue = await adminDb.exchangeRate.findFirstOrThrow({
		where: { currency: "ARS", type: "blue" },
		orderBy: { date: "desc" },
	});
	await adminDb.exchangeRateFavorite.create({
		data: { userId: s.user.id, exchangeRateId: blue.id, order: 0 },
	});
	return s;
}

const monthly = (amountMinor: number) => ({
	kind: "MONTHLY" as const,
	amountMinor,
	mode: "REFILL" as const,
	cadence: "MONTH" as const,
});

/**
 * Flex with two groups, three envelopes (Rent and Dining linked to a category
 * each, Spending the default), one income rule and ARS 2,000.00 to start.
 * Rent 1,000.00 and Dining 500.00 are planned, so 500.00 stays Not planned yet.
 */
export function arsFlex(s: Seeded): SetupInput {
	return {
		style: "FLEX",
		startingMoneyMinor: 200_000,
		groups: [
			{ key: "bills", name: "Bills", role: "BILLS" },
			{ key: "spending", name: "Spending", role: "SPENDING" },
		],
		rules: [
			{
				name: "Salary",
				match: { kind: "ANY" },
				action: { kind: "PERCENT", basisPoints: 2_000 },
				envelopeKey: "rent",
			},
		],
		envelopes: [
			{
				key: "rent",
				name: "Rent",
				groupKey: "bills",
				kind: "MONTHLY",
				isDefault: false,
				categoryIds: [s.rent],
				target: monthly(100_000),
			},
			{
				key: "dining",
				name: "Dining",
				groupKey: "spending",
				kind: "MONTHLY",
				isDefault: false,
				categoryIds: [s.dining],
				target: monthly(50_000),
			},
			{
				key: "spending",
				name: "Spending",
				groupKey: "spending",
				kind: "MONTHLY",
				isDefault: true,
				categoryIds: [],
			},
		],
	};
}

/** The smallest budget: one envelope that is the default, `start` to begin with. */
export function oneEnvelope(start: number): SetupInput {
	return {
		style: "FLEX",
		startingMoneyMinor: start,
		groups: [{ key: "spending", name: "Spending", role: "SPENDING" }],
		envelopes: [
			{
				key: "spending",
				name: "Spending",
				groupKey: "spending",
				kind: "MONTHLY",
				isDefault: true,
				categoryIds: [],
			},
		],
	};
}

/** The shared USD fixture as Limits: no money now, every envelope funded from its limit. */
export function limitsFrom(s: Seeded): SetupInput {
	const input = setupInput(s);
	return {
		...input,
		style: "LIMITS",
		startingMoneyMinor: undefined,
		envelopes: input.envelopes.map((e) =>
			e.key === "rent" ? { ...e, target: monthly(42_000) } : e,
		),
	};
}

/** Starts the budget as the web does and returns what an undo needs. */
export async function startBudget(userId: string, input: SetupInput) {
	const done = await forUser(userId).apply(setupEnvelopeBook, {
		...input,
		timeZone: "UTC",
	});
	const book = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: userId },
	});
	return {
		token: done.value.restore,
		bookId: done.value.bookId,
		expenseId: book.startingBalanceExpenseId,
		done,
	};
}

/** Applies the undo of a set-up, as the web's procedure does. */
export const undoWith = (
	userId: string,
	token: Awaited<ReturnType<typeof startBudget>>["token"],
) => forUser(userId).apply(undoSetupEnvelopeBook, { token });

/** Rows of a book per table, counted by the tables themselves. */
export async function counts(bookId: string) {
	const where = { bookId };
	return {
		envelope_group: await adminDb.envelopeGroup.count({ where }),
		envelope: await adminDb.envelope.count({ where }),
		envelope_category: await adminDb.envelopeCategory.count({ where }),
		budget_movement: await adminDb.budgetMovement.count({ where }),
		book_period: await adminDb.bookPeriod.count({ where }),
		budget_member: await adminDb.budgetMember.count({ where }),
		month_close: await adminDb.monthClose.count({ where }),
		income_rule: await adminDb.incomeRule.count({ where }),
		income_rule_run: await adminDb.incomeRuleRun.count({ where }),
		payoff_plan: await adminDb.payoffPlan.count({ where }),
		wealth_transfer: await adminDb.wealthTransfer.count({ where }),
		envelope_change: await adminDb.envelopeChange.count({ where }),
		budget_draft: await adminDb.budgetDraft.count({ where }),
		budget_dirty: await adminDb.budgetDirty.count({ where }),
		budget_row_value: await adminDb.budgetRowValue.count({ where }),
		budget_book: await adminDb.budgetBook.count({ where: { id: bookId } }),
	};
}

export const NO_ROWS = {
	envelope_group: 0,
	envelope: 0,
	envelope_category: 0,
	budget_movement: 0,
	book_period: 0,
	budget_member: 0,
	month_close: 0,
	income_rule: 0,
	income_rule_run: 0,
	payoff_plan: 0,
	wealth_transfer: 0,
	envelope_change: 0,
	budget_draft: 0,
	budget_dirty: 0,
	budget_row_value: 0,
	budget_book: 0,
};

/**
 * Pay off debt: a Visa owing 1,200.00 at 24% with a 50.00 minimum, an extra
 * 100.00 a month on its own envelope, so the set-up saves a payoff plan.
 */
export function debtPayoffInput(s: Seeded, visaId: string): SetupInput {
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
				key: "visa",
				name: "Visa minimum",
				groupKey: "debts",
				kind: "BILL",
				isDefault: false,
				categoryIds: [],
				target: { kind: "BILL_LIABILITY", liabilityId: visaId },
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
			extraMonthlyMinor: 10_000,
			envelopeKey: "extra-debt",
		},
	};
}
