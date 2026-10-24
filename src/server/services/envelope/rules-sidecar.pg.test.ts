/**
 * Income rules on Postgres (SPEC §5.10, 02 §7 rules-sidecar.pg.test.ts).
 * USD book (fixture: starting money 1,000.00, Rent, Dining, Spending), one
 * rule "Save" 20% to Rent. Expected values by hand:
 *
 *   A sidecar-posted income of 2,000.00, read by five requests at once:
 *   one income_rule_run, one RULE batch of 40,000 to Rent. To assign
 *   100,000 + 200,000 - 40,000 = 260,000.
 *   Edited to 2,500.00: a delta batch of +10,000 (Rent 50,000); To assign
 *   100,000 + 250,000 - 50,000 = 300,000.
 *   S16: Dining gets all 300,000, then the income is deleted: the rule batch
 *   reverts (Rent 0) and To assign is 100,000 - 300,000 = -200,000, "you
 *   assigned 200,000 more than you have"; the invariant holds.
 *   Undoing a rule batch marks its money in "rules skipped": an edit after
 *   that writes nothing.
 *   Use my plan on a new 1,000.00: the rule takes 20,000 first, the plan
 *   assigns from the other 80,000.
 *   "Also apply to this month's money in" for a new Dining 10% rule reaches
 *   the 1,000.00 logged before it: Dining +10,000; the preview writes
 *   nothing; a retry with the same batch writes nothing more.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import {
	addRow,
	invariantAt,
	seedUser,
	setupInput,
} from "./__tests__/pg-fixture";
import { assignEnvelopes, moveMoney, undoMovements } from "./movement.mutation";
import { applyRuleToMonthMutation } from "./plan.mutation";
import { getMonth } from "./read.service";
import { createRule } from "./rule-crud.service";
import { setupEnvelopeBook } from "./setup.mutation";
import { applyPlan } from "./use-my-plan";

type Seeded = Awaited<ReturnType<typeof seedUser>>;

async function book(s: Seeded) {
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...setupInput(s),
		timeZone: "UTC",
	});
	const b = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: s.user.id },
		include: { envelopes: true },
	});
	const id = (name: string) =>
		b.envelopes.find((e) => e.name === name)?.id as string;
	return { bookId: b.id, id };
}

function rule(
	s: Seeded,
	envelopeId: string,
	bp: number,
	at = new Date(Date.now() - 60_000),
) {
	return userTransaction(adminDb, s.user.id, (tx) =>
		createRule(
			tx,
			s.user.id,
			{
				id: randomUUID(),
				name: "Save",
				match: { kind: "ANY" },
				action: { kind: "PERCENT", basisPoints: bp },
				envelopeId,
			},
			at,
		),
	);
}

/** What the Go sidecar writes for a recurring money in: a plain expense row, outside the TS services. */
const income = (s: Seeded, amount: number) =>
	addRow(s.user.id, { amount, direction: "IN", inType: "INCOME" });

const ruleRows = (bookId: string) =>
	adminDb.budgetMovement.findMany({
		where: { bookId, kind: "RULE" },
		orderBy: { createdAt: "asc" },
	});

const rowOf = (m: Awaited<ReturnType<typeof getMonth>>, id: string) =>
	m?.groups.flatMap((g) => g.envelopes).find((e) => e.id === id);

describe("rules on sidecar income run exactly once (rules-sidecar)", () => {
	let s: Seeded;
	let b: Awaited<ReturnType<typeof book>>;
	let salary: { id: string };

	beforeAll(async () => {
		s = await seedUser();
		b = await book(s);
		await rule(s, b.id("Rent"), 2_000);
		salary = await income(s, 2_000);
	});

	it("five concurrent reads write one run and one batch of 40,000 to Rent", async () => {
		const reads = await Promise.all(
			Array.from({ length: 5 }, () => getMonth(s.user.id)),
		);
		expect(reads.map((m) => m?.toAssign.amount.minor)).toEqual(
			Array(5).fill(260_000),
		);
		await expect(
			adminDb.incomeRuleRun.count({ where: { bookId: b.bookId } }),
		).resolves.toBe(1);
		const rows = await ruleRows(b.bookId);
		expect(
			rows.map((r) => [r.toEnvelopeId, Number(r.amount), r.sourceExpenseId]),
		).toEqual([[b.id("Rent"), 400, salary.id]]);
		expect(new Set(rows.map((r) => r.batchId)).size).toBe(1);
	});

	it("an edit to 2,500.00 writes a +10,000 delta; reading again writes nothing", async () => {
		await adminDb.expense.update({
			where: { id: salary.id },
			data: {
				amount: new Prisma.Decimal(2_500),
				amountInUSD: new Prisma.Decimal(2_500),
			},
		});
		const m = await getMonth(s.user.id);
		await getMonth(s.user.id);
		expect(m?.toAssign.amount.minor).toBe(300_000);
		expect(rowOf(m, b.id("Rent"))?.assigned.minor).toBe(50_000);
		expect((await ruleRows(b.bookId)).map((r) => Number(r.amount))).toEqual([
			400, 100,
		]);
	});

	it("S16: deleting the income after assigning reverts its rule batch; To assign -200,000", async () => {
		await forUser(s.user.id).apply(assignEnvelopes, {
			batchId: randomUUID(),
			month: (await getMonth(s.user.id))?.month.key as number,
			mode: "add",
			items: [
				{ id: randomUUID(), envelopeId: b.id("Dining"), amountMinor: 300_000 },
			],
		});
		await adminDb.expense.delete({ where: { id: salary.id } });
		const m = await getMonth(s.user.id);
		expect(m?.toAssign.amount.minor).toBe(-200_000);
		expect(rowOf(m, b.id("Rent"))?.assigned.minor).toBe(0);
		const last = (await ruleRows(b.bookId)).at(-1);
		expect([
			last?.fromEnvelopeId,
			Number(last?.amount),
			last?.sourceExpenseId,
		]).toEqual([b.id("Rent"), 500, null]);
		const sides = await invariantAt(s.user.id);
		expect(sides.budget).toBe(sides.ledger);
	});
});

describe("undo, Use my plan and Also apply", () => {
	let s: Seeded;
	let b: Awaited<ReturnType<typeof book>>;

	beforeAll(async () => {
		s = await seedUser();
		b = await book(s);
		await rule(s, b.id("Rent"), 2_000);
	});

	it("undoing a rule batch marks the money in rules skipped; an edit after writes nothing", async () => {
		const row = await income(s, 1_000);
		await getMonth(s.user.id);
		const [batch] = await ruleRows(b.bookId);
		await forUser(s.user.id).apply(undoMovements, {
			id: randomUUID(),
			target: { batchId: batch?.batchId as string },
		});
		await expect(
			adminDb.incomeRuleRun.findUniqueOrThrow({ where: { expenseId: row.id } }),
		).resolves.toMatchObject({
			skipped: true,
		});
		await adminDb.expense.update({
			where: { id: row.id },
			data: { amount: new Prisma.Decimal(1_500) },
		});
		await getMonth(s.user.id);
		await expect(
			adminDb.budgetMovement.count({
				where: { bookId: b.bookId, kind: "RULE" },
			}),
		).resolves.toBe(1);
	});

	it("Use my plan plans what the rules left: 80,000 of a 1,000.00 money in", async () => {
		const row = await income(s, 1_000);
		const plan = await userTransaction(adminDb, s.user.id, (tx) =>
			applyPlan(tx, s.user.id, new Date(), {
				amount: 100_000,
				rest: "LEAVE",
				sourceExpenseId: row.id,
			}),
		);
		const planned = (plan?.lines ?? []).reduce((t, l) => t + l.amount.minor, 0);
		expect(planned + (plan?.rest.minor ?? 0)).toBe(80_000);
		const ran = await adminDb.budgetMovement.findMany({
			where: { sourceExpenseId: row.id, kind: "RULE" },
		});
		expect(ran.map((r) => Number(r.amount))).toEqual([200]);
	});

	it("Also apply to this month's money in: Dining 10% of the 1,000.00 before it; preview writes nothing; a retry adds nothing", async () => {
		const dining = await rule(s, b.id("Dining"), 1_000, new Date());
		const input = { batchId: randomUUID(), ruleId: dining.id };
		const before = await adminDb.budgetMovement.count();
		const p = await forUser(s.user.id).preview(applyRuleToMonthMutation, input);
		expect(
			p.value.runs.map((r) =>
				r.lines.map((l) => [l.envelopeId, l.amount.minor]),
			),
		).toEqual([[[b.id("Dining"), 10_000]]]);
		await expect(adminDb.budgetMovement.count()).resolves.toBe(before);
		await forUser(s.user.id).apply(applyRuleToMonthMutation, input);
		await forUser(s.user.id).apply(applyRuleToMonthMutation, input);
		const rows = await adminDb.budgetMovement.findMany({
			where: { batchId: input.batchId },
		});
		expect(rows.map((r) => [r.toEnvelopeId, Number(r.amount)])).toEqual([
			[b.id("Dining"), 100],
		]);
		const sides = await invariantAt(s.user.id);
		expect(sides.budget).toBe(sides.ledger);
	});
});

/**
 * Review round 1. Starting money 100,000, rule 20% to Rent, a 1,000.00
 * money in: Rent 20,000, To assign 100,000 + 100,000 - 20,000 = 180,000.
 *   Finding 1: the money in goes away (deleted, or kept in Wealth) and
 *   comes back (Undo of the delete restores the same id and createdAt, or
 *   keep in Wealth is turned off): its rules run again, Rent 20,000 and To
 *   assign 180,000 (not Rent 0 and 200,000).
 *   Finding 2: edited to 1,500.00 (delta +10,000), then the delta batch is
 *   undone: every rule batch of that money in is taken back (Rent 0, To
 *   assign 250,000) and the row is skipped; deleting it then leaves To
 *   assign at the starting 100,000 with nothing stranded in Rent.
 */
describe("a money in that goes away and comes back (review round 1)", () => {
	const state = async (s: Seeded, rent: string) => {
		const m = await getMonth(s.user.id);
		return [rowOf(m, rent)?.assigned.minor, m?.toAssign.amount.minor];
	};

	it("Undo of a delete (same id and createdAt) runs the rules again", async () => {
		const s = await seedUser();
		const b = await book(s);
		await rule(s, b.id("Rent"), 2_000);
		const row = await income(s, 1_000);
		await expect(state(s, b.id("Rent"))).resolves.toEqual([20_000, 180_000]);
		const { id, createdAt, updatedAt, ...data } = await adminDb.expense.delete({
			where: { id: row.id },
		});
		await expect(state(s, b.id("Rent"))).resolves.toEqual([0, 100_000]);
		await adminDb.expense.create({ data: { ...data, id, createdAt } as never });
		await expect(state(s, b.id("Rent"))).resolves.toEqual([20_000, 180_000]);
		const sides = await invariantAt(s.user.id);
		expect(sides.budget).toBe(sides.ledger);
	});

	it("keep in Wealth on, then off, runs the rules again", async () => {
		const s = await seedUser();
		const b = await book(s);
		await rule(s, b.id("Rent"), 2_000);
		const row = await income(s, 1_000);
		await expect(state(s, b.id("Rent"))).resolves.toEqual([20_000, 180_000]);
		await adminDb.expense.update({
			where: { id: row.id },
			data: { keepInWealth: true },
		});
		await expect(state(s, b.id("Rent"))).resolves.toEqual([0, 100_000]);
		await adminDb.expense.update({
			where: { id: row.id },
			data: { keepInWealth: false },
		});
		await expect(state(s, b.id("Rent"))).resolves.toEqual([20_000, 180_000]);
	});

	it("undoing a later rule batch takes back every rule batch of that money in", async () => {
		const s = await seedUser();
		const b = await book(s);
		await rule(s, b.id("Rent"), 2_000);
		const row = await income(s, 1_000);
		await getMonth(s.user.id);
		await adminDb.expense.update({
			where: { id: row.id },
			data: {
				amount: new Prisma.Decimal(1_500),
				amountInUSD: new Prisma.Decimal(1_500),
			},
		});
		await expect(state(s, b.id("Rent"))).resolves.toEqual([30_000, 220_000]);
		const delta = (await ruleRows(b.bookId)).at(-1);
		await forUser(s.user.id).apply(undoMovements, {
			id: randomUUID(),
			target: { batchId: delta?.batchId as string },
		});
		await expect(state(s, b.id("Rent"))).resolves.toEqual([0, 250_000]);
		await adminDb.expense.delete({ where: { id: row.id } });
		await expect(state(s, b.id("Rent"))).resolves.toEqual([0, 100_000]);
		const sides = await invariantAt(s.user.id);
		expect(sides.budget).toBe(sides.ledger);
	});
});

/**
 * Review round 2: the take-back cap holds for every row an undo writes. A
 * 1,000.00 money in dated next month: the rule puts 20,000 in Rent next
 * month; edited to 1,500.00, a +10,000 delta. 15,000 of Rent's 30,000 then
 * moves to Dining next month, so Rent holds 15,000 there. Undoing the delta
 * would hand back 10,000 and then the first batch's 20,000: 30,000 to To
 * assign from an envelope holding 15,000, so the undo is refused and
 * nothing is written.
 */
describe("undoing a next-month rule batch (review round 2)", () => {
	it("checks the take-back cap on the money in's other batches too", async () => {
		const s = await seedUser();
		const b = await book(s);
		await rule(s, b.id("Rent"), 2_000);
		const c = (await getMonth(s.user.id))?.month.key as number;
		const next = c % 100 === 12 ? c + 89 : c + 1;
		const day = new Date(
			Date.UTC(Math.floor(next / 100), (next % 100) - 1, 10, 15),
		);
		const row = await addRow(
			s.user.id,
			{ amount: 1_000, direction: "IN", inType: "INCOME" },
			day,
		);
		await getMonth(s.user.id);
		await adminDb.expense.update({
			where: { id: row.id },
			data: {
				amount: new Prisma.Decimal(1_500),
				amountInUSD: new Prisma.Decimal(1_500),
			},
		});
		const m = await getMonth(s.user.id, next);
		expect(rowOf(m, b.id("Rent"))?.assigned.minor).toBe(30_000);
		await forUser(s.user.id).apply(moveMoney, {
			id: randomUUID(),
			month: next,
			from: b.id("Rent"),
			to: b.id("Dining"),
			amountMinor: 15_000,
			kind: "MOVE",
		});
		const delta = (await ruleRows(b.bookId)).at(-1);
		const before = await adminDb.budgetMovement.count({
			where: { bookId: b.bookId },
		});
		await expect(
			forUser(s.user.id).apply(undoMovements, {
				id: randomUUID(),
				target: { batchId: delta?.batchId as string },
			}),
		).rejects.toThrow(/more than the envelope holds/);
		await expect(
			adminDb.budgetMovement.count({ where: { bookId: b.bookId } }),
		).resolves.toBe(before);
	});
});

describe("P5 tables are book tables (RLS)", () => {
	it("a non-member sees no rules, runs or drafts of another book", async () => {
		const alice = await seedUser();
		const bob = await seedUser();
		const a = await book(alice);
		await rule(alice, a.id("Rent"), 2_000);
		await income(alice, 100);
		await getMonth(alice.user.id);
		await adminDb.budgetDraft.create({
			data: {
				id: randomUUID(),
				bookId: a.bookId,
				month: 209901,
				createdById: alice.user.id,
			},
		});
		const where = { bookId: a.bookId };
		await expect(alice.db.incomeRule.count({ where })).resolves.toBe(1);
		await expect(alice.db.incomeRuleRun.count({ where })).resolves.toBe(1);
		await expect(bob.db.incomeRule.findMany({ where })).resolves.toEqual([]);
		await expect(bob.db.incomeRuleRun.findMany({ where })).resolves.toEqual([]);
		await expect(bob.db.budgetDraft.findMany({ where })).resolves.toEqual([]);
		await expect(
			bob.db.incomeRule.create({
				data: {
					id: randomUUID(),
					bookId: a.bookId,
					sortOrder: 9,
					name: "x",
					action: "REMAINDER",
					envelopeId: a.id("Rent"),
				},
			}),
		).rejects.toThrow();
	});
});
