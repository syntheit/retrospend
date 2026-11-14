/**
 * Taking back starting a budget (envelope.undoSetup) on Postgres, with the
 * row-level security of a signed-in user. Expected values by hand:
 *
 *   ARS home at the blue rate, Flex, 2,000.00 to start (200,000 minor), Rent
 *   1,000.00 and Dining 500.00 planned: the book holds 2 groups, 3 envelopes,
 *   2 category links, 1 owner, 1 period, 1 rule and 2 ASSIGN movements of
 *   1,000.00 and 500.00; Not planned yet is 200,000 - 150,000 = 50,000.
 *   Undo removes every one of those rows and the starting balance expense
 *   (the user keeps the 2 other expenses, 2 categories and 1 account), and
 *   the budget reads as "no budget". Starting again with 3,000.00 and one
 *   envelope then has 300,000 to plan, nothing carried over from the first.
 *   Limits (USD, Rent 420.00, Dining 200.00): 2 PLAN_FUND movements, Not
 *   planned yet -62,000. Pay off debt: 1 payoff plan, the Visa stays.
 */
import { describe, expect, it } from "vitest";
import type { SetupInput } from "~/lib/schemas/envelope";
import {
	RESTORE_TTL_MS,
	signRestore,
} from "~/server/services/entry/restore-token";
import { forUser } from "~/server/services/preview";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import { figure, openAccount } from "../accounts/test-fixtures";
import { addRow, seedUser, setupInput } from "./__tests__/pg-fixture";
import {
	arsBlueUser,
	arsFlex,
	counts,
	debtPayoffInput,
	limitsFrom,
	NO_ROWS,
	oneEnvelope,
	startBudget,
	undoWith,
} from "./__tests__/setup-undo-fixture";
import { debtsApi } from "./debt-api.service";
import { getLeftToSpend, getMonth, getVerdict } from "./read.service";
import { undoSetupEnvelopeBook } from "./setup-undo.mutation";
import { SETUP_UNDO_KIND } from "./setup-undo.service";

const FLEX_ROWS = {
	envelope_group: 2,
	envelope: 3,
	envelope_category: 2,
	budget_movement: 2,
	book_period: 1,
	budget_member: 1,
	month_close: 0,
	income_rule: 1,
	income_rule_run: 0,
	payoff_plan: 0,
	wealth_transfer: 0,
	envelope_change: 0,
	budget_draft: 0,
	budget_book: 1,
};

const idsOf = async (bookId: string) => ({
	groups: (await adminDb.envelopeGroup.findMany({ where: { bookId } })).map(
		(r) => r.id,
	),
	envelopes: (await adminDb.envelope.findMany({ where: { bookId } })).map(
		(r) => r.id,
	),
	links: (await adminDb.envelopeCategory.findMany({ where: { bookId } })).map(
		(r) => r.id,
	),
	movements: (await adminDb.budgetMovement.findMany({ where: { bookId } })).map(
		(r) => r.id,
	),
	periods: (await adminDb.bookPeriod.findMany({ where: { bookId } })).map(
		(r) => r.id,
	),
	members: (await adminDb.budgetMember.findMany({ where: { bookId } })).map(
		(r) => r.id,
	),
	rules: (await adminDb.incomeRule.findMany({ where: { bookId } })).map(
		(r) => r.id,
	),
});

describe("undo of a Flex set-up in ARS at the blue rate", () => {
	it("previews the book going, then removes it and its starting balance and nothing else", async () => {
		const s = await arsBlueUser();
		// Dated before the budget's first month, so the book never counts it.
		const earlier = await addRow(
			s.user.id,
			{ amount: 50, categoryId: s.dining },
			new Date(Date.now() - 60 * 86_400_000),
		);
		await openAccount(s.user.id, "Cash", "CASH", "ARS", 5_000);
		const netWorth = await figure(s.user.id, "netWorth");
		const start = await startBudget(s.user.id, arsFlex(s));
		expect(await counts(start.bookId)).toMatchObject(FLEX_ROWS);
		const moved = await adminDb.budgetMovement.findMany({
			where: { bookId: start.bookId },
		});
		expect(moved.map((m) => m.kind)).toEqual(["ASSIGN", "ASSIGN"]);
		expect(moved.map((m) => m.amount.toString()).sort()).toEqual([
			"1000",
			"500",
		]);
		expect((await getMonth(s.user.id))?.toAssign.amount).toEqual({
			minor: 50_000,
			currency: "ARS",
		});
		const ids = await idsOf(start.bookId);
		expect(start.expenseId).not.toBeNull();
		// Spending logged after the budget started, and read by a page, is not held by the book.
		const later = await addRow(s.user.id, { amount: 7, categoryId: s.dining });
		await getMonth(s.user.id);

		// The preview is the same delete rolled back: it answers and leaves the book.
		const preview = await forUser(s.user.id).preview(undoSetupEnvelopeBook, {
			token: start.token,
		});
		expect(preview.value).toEqual({
			bookId: start.bookId,
			expenseId: start.expenseId,
		});
		expect(await counts(start.bookId)).toMatchObject(FLEX_ROWS);
		await expect(
			fixtureDb.expense.count({ where: { id: start.expenseId as string } }),
		).resolves.toBe(1);

		const applied = await undoWith(s.user.id, start.token);
		expect(applied.value).toEqual(preview.value);
		expect(applied.undo).toEqual({
			kind: "revert",
			mutation: "envelope.setup",
			rows: [],
		});

		expect(await counts(start.bookId)).toEqual(NO_ROWS);
		for (const [model, list] of [
			[adminDb.envelopeGroup, ids.groups],
			[adminDb.envelope, ids.envelopes],
			[adminDb.envelopeCategory, ids.links],
			[adminDb.budgetMovement, ids.movements],
			[adminDb.bookPeriod, ids.periods],
			[adminDb.budgetMember, ids.members],
			[adminDb.incomeRule, ids.rules],
		] as const)
			await expect(
				(model as { count: (a: unknown) => Promise<number> }).count({
					where: { id: { in: list } },
				}),
			).resolves.toBe(0);
		// Hand-listed: the expense from before and the one after remain, the starting balance went.
		const left = await fixtureDb.expense.findMany({
			where: { userId: s.user.id },
			select: { id: true },
		});
		expect(left.map((e) => e.id).sort()).toEqual([earlier.id, later.id].sort());
		await expect(
			fixtureDb.category.count({ where: { userId: s.user.id } }),
		).resolves.toBe(2);
		await expect(
			adminDb.assetAccount.count({ where: { userId: s.user.id } }),
		).resolves.toBe(1);
		expect(await figure(s.user.id, "netWorth")).toEqual(netWorth);
		expect(await getMonth(s.user.id)).toBeNull();
	});

	it("a second use of the token finds the book gone", async () => {
		const s = await arsBlueUser();
		const start = await startBudget(s.user.id, arsFlex(s));
		await undoWith(s.user.id, start.token);
		await expect(undoWith(s.user.id, start.token)).rejects.toMatchObject({
			code: "ALREADY_UNDONE",
		});
	});

	it("a new start has only what it is given, and the spent token never reaches it", async () => {
		const s = await arsBlueUser();
		const first = await startBudget(s.user.id, arsFlex(s));
		await undoWith(s.user.id, first.token);
		const again = await startBudget(s.user.id, oneEnvelope(300_000));
		expect(again.bookId).not.toBe(first.bookId);
		// 300,000 to plan: the first start's 200,000 and its plan left nothing behind.
		expect((await getMonth(s.user.id))?.toAssign.amount).toEqual({
			minor: 300_000,
			currency: "ARS",
		});
		expect(await counts(again.bookId)).toMatchObject({
			budget_book: 1,
			envelope_group: 1,
			envelope: 1,
			envelope_category: 0,
			budget_movement: 0,
			income_rule: 0,
		});
		await expect(undoWith(s.user.id, first.token)).rejects.toMatchObject({
			code: "ALREADY_UNDONE",
		});
		expect((await counts(again.bookId)).budget_book).toBe(1);
	});
});

describe("undo for each way of starting", () => {
	it("Limits: the PLAN_FUND rows go with the book", async () => {
		const s = await seedUser();
		const start = await startBudget(s.user.id, limitsFrom(s));
		const rows = await adminDb.budgetMovement.findMany({
			where: { bookId: start.bookId },
		});
		expect(rows.map((r) => r.kind)).toEqual(["PLAN_FUND", "PLAN_FUND"]);
		expect((await getMonth(s.user.id))?.toAssign.amount.minor).toBe(-62_000);
		await undoWith(s.user.id, start.token);
		expect(await counts(start.bookId)).toEqual(NO_ROWS);
		expect(await getMonth(s.user.id)).toBeNull();
	});

	it("Flex with a sweep: the envelope that sweeps and the one it sweeps to go together", async () => {
		const s = await seedUser();
		const input: SetupInput = {
			...arsFlex(s),
			envelopes: arsFlex(s).envelopes.map((e) =>
				e.key === "dining" ? { ...e, sweepToKey: "spending" } : e,
			),
		};
		const start = await startBudget(s.user.id, input);
		await expect(
			adminDb.envelope.count({
				where: { bookId: start.bookId, leftoverRule: "SWEEP" },
			}),
		).resolves.toBe(1);
		await undoWith(s.user.id, start.token);
		expect(await counts(start.bookId)).toEqual(NO_ROWS);
	});

	it("Pay off debt: the payoff plan goes, the Visa and its terms stay", async () => {
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
		const start = await startBudget(s.user.id, debtPayoffInput(s, visa));
		expect((await counts(start.bookId)).payoff_plan).toBe(1);
		await undoWith(s.user.id, start.token);
		expect(await counts(start.bookId)).toEqual(NO_ROWS);
		const account = await fixtureDb.assetAccount.findUniqueOrThrow({
			where: { id: visa },
		});
		expect(account.balance.toString()).toBe("1200");
	});
});

describe("reading the budget never blocks the undo", () => {
	/** The pages a person opens first: the month, the verdict, Left to spend. */
	async function readEverything(userId: string) {
		await getMonth(userId);
		await getMonth(userId);
		await getVerdict(userId);
		await getLeftToSpend(userId);
	}

	const rules = [
		{
			name: "Save",
			match: { kind: "ANY" as const },
			action: { kind: "PERCENT" as const, basisPoints: 2_000 },
			envelopeKey: "spending",
		},
	];

	it.each([
		["LIMITS", (s: Awaited<ReturnType<typeof seedUser>>) => limitsFrom(s)],
		["FLEX", (s: Awaited<ReturnType<typeof seedUser>>) => ({ ...arsFlex(s) })],
		[
			"SAVE_FIRST with rules",
			(s: Awaited<ReturnType<typeof seedUser>>) => ({
				...setupInput(s),
				rules,
			}),
		],
		[
			"FIFTY_THIRTY_TWENTY",
			(s: Awaited<ReturnType<typeof seedUser>>) => ({
				...setupInput(s),
				style: "FIFTY_THIRTY_TWENTY" as const,
			}),
		],
	])("%s", async (_style, input) => {
		const s = await seedUser();
		const start = await startBudget(s.user.id, input(s));
		await readEverything(s.user.id);
		await undoWith(s.user.id, start.token);
		expect(await counts(start.bookId)).toEqual(NO_ROWS);
		expect(await getMonth(s.user.id)).toBeNull();
	});

	it("DEBT_PAYOFF", async () => {
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
		const start = await startBudget(s.user.id, debtPayoffInput(s, visa));
		await readEverything(s.user.id);
		await undoWith(s.user.id, start.token);
		expect(await counts(start.bookId)).toEqual(NO_ROWS);
	});
});

describe("a token that is not this user's, this kind, or fresh", () => {
	it("is refused and the book stays", async () => {
		const s = await seedUser();
		const stranger = await seedUser();
		const start = await startBudget(s.user.id, oneEnvelope(100_000));
		const payload = (JSON.parse(start.token.data) as { payload: unknown })
			.payload;
		const refused = { code: "BAD_REQUEST" };
		const stayed = async () =>
			expect((await counts(start.bookId)).budget_book).toBe(1);

		// Another kind of token with the same footprint.
		await expect(
			undoWith(s.user.id, signRestore("expense.delete", s.user.id, payload)),
		).rejects.toMatchObject(refused);
		// The right token in another user's hands.
		await expect(undoWith(stranger.user.id, start.token)).rejects.toMatchObject(
			refused,
		);
		// Past its 24 hours.
		await expect(
			undoWith(
				s.user.id,
				signRestore(
					SETUP_UNDO_KIND,
					s.user.id,
					payload,
					Date.now() - RESTORE_TTL_MS - 1_000,
				),
			),
		).rejects.toMatchObject(refused);
		// A signature that is not ours, and a payload changed under a good one.
		await expect(
			undoWith(s.user.id, { data: start.token.data, sig: "0".repeat(64) }),
		).rejects.toMatchObject(refused);
		await expect(
			undoWith(s.user.id, {
				data: start.token.data.replace(start.bookId, "x".repeat(25)),
				sig: start.token.sig,
			}),
		).rejects.toMatchObject(refused);
		await stayed();

		await undoWith(s.user.id, start.token);
		expect((await counts(start.bookId)).budget_book).toBe(0);
	});
});
