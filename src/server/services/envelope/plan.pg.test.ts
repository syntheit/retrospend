/**
 * Planning on Postgres (02 §8 P5; SPEC §5.9, §5.13; owner r5 Q1). USD book
 * from the fixture: starting money 1,000.00 (To assign 100,000), Rent Set
 * aside 500.00 (Bills), Dining Refill 200.00 and Spending (Spending).
 * Expected values by hand:
 *
 *   Plan next month: Rent 50,000, Dining 20,000, expected money in 3,000.00.
 *   Next month's To assign 100,000 before, 100,000 + 300,000 - 70,000 =
 *   330,000 after; Fund it now would take 70,000. Preview and Apply write
 *   no movement and leave this month's figures as they are. Use my plan next
 *   month starts from the plan: Rent 50,000 and Dining 20,000 (step PLAN),
 *   nothing more from targets, 30,000 stays Not planned yet. Fund it now
 *   writes one PLAN_APPLY batch of 70,000: To assign 30,000; undo: 100,000.
 *   What if this month: a move of 30,000 out of Dining (which holds 20,000)
 *   is refused (S15); a 5,000 move from To assign is written, the pretend
 *   expense is not.
 *   Plan cost 70,000; essentials (Bills) 50,000; runway 100,000 / 50,000 =
 *   2.0 months (20 tenths); no closed month, so no typical income.
 *   Typical income (August book read on Nov 4): Aug 1,000.00, Sep 3,000.00,
 *   Oct 2,000.00, median 200,000.
 *   Group targets: Spending 300.00 with Dining's own 200.00 first: need
 *   30,000, main Spending gets 10,000. Bills 50% of 2,000.00 money in:
 *   100,000, no main envelope (Rent has its own target).
 *   Year view 2026 of the August book (Oct 23): July shows Dining's 40.00
 *   spent before the start; August assigned 30,000, spent 10,000, left
 *   20,000; September spent 5,000, left 15,000.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { readFigures } from "~/server/figures/read";
import { userTransaction } from "~/server/db-tx";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { addRow, at, augustBook, invariantAt, seedUser, setupInput } from "./__tests__/pg-fixture";
import { addMonths } from "./calendar";
import { undoMovements } from "./movement.mutation";
import { draftsApi, getPlanCost, getYearView, putGroupTarget } from "./plan-api.service";
import {
	applyDraftMutation,
	fundPlanNowMutation,
	unapplyDraftMutation,
} from "./plan.mutation";
import { planCostIn } from "./plan-read";
import { getFillFromTargets, getMonth } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";

type Seeded = Awaited<ReturnType<typeof seedUser>>;
const usd = (minor: number) => ({ minor, currency: "USD" });

async function book(s: Seeded) {
	await forUser(s.user.id).apply(setupEnvelopeBook, { ...setupInput(s), timeZone: "UTC" });
	const b = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: s.user.id },
		include: { envelopes: true, groups: true },
	});
	const id = (name: string) => b.envelopes.find((e) => e.name === name)?.id as string;
	const group = (name: string) => b.groups.find((g) => g.name === name)?.id as string;
	const c = (await getMonth(s.user.id))?.month.key as number;
	return { bookId: b.id, id, group, c, next: addMonths(c, 1) };
}

describe("Plan next month: a draft until payday (owner r5 Q1)", () => {
	let s: Seeded;
	let b: Awaited<ReturnType<typeof book>>;
	const draftId = randomUUID();

	beforeAll(async () => {
		s = await seedUser();
		b = await book(s);
		await draftsApi.save(s.user.id, {
			id: draftId,
			kind: "PLAN",
			month: b.next,
			lines: [
				{ envelopeId: b.id("Rent"), amountMinor: 50_000 },
				{ envelopeId: b.id("Dining"), amountMinor: 20_000 },
			],
			moves: [],
			expectedIn: [{ id: randomUUID(), templateId: null, categoryId: null, amountMinor: 300_000 }],
			pretend: [],
		});
	});

	it("previews next month: 100,000 before, 330,000 after; Fund it now would take 70,000; nothing written", async () => {
		const before = await adminDb.budgetMovement.count({ where: { bookId: b.bookId } });
		const p = await draftsApi.preview(s.user.id, draftId);
		expect(p.toAssign).toEqual({ before: usd(100_000), after: usd(330_000) });
		expect(p.fundNow).toEqual(usd(70_000));
		expect(p.stale).toBe(false);
		await expect(adminDb.budgetMovement.count({ where: { bookId: b.bookId } })).resolves.toBe(before);
		await expect(adminDb.expense.count({ where: { userId: s.user.id, direction: "IN", entryKind: "STANDARD" } })).resolves.toBe(0);
	});

	it("Apply saves the plan and changes nothing this month", async () => {
		const p = await forUser(s.user.id).preview(applyDraftMutation, { draftId });
		expect(p.changes).toEqual([]);
		expect(p.unchanged.map((u) => u.id)).toContain("budget.notPlannedYet");
		const r = await forUser(s.user.id).apply(applyDraftMutation, { draftId });
		expect(r.value.draft.status).toBe("APPLIED");
		expect(r.undo).toMatchObject({ mutation: "envelope.unapplyDraft" });
		await expect(adminDb.budgetMovement.count({ where: { bookId: b.bookId } })).resolves.toBe(0);
		expect((await getMonth(s.user.id))?.toAssign.amount).toEqual(usd(100_000));
		await expect(draftsApi.get(s.user.id, { kind: "PLAN" })).resolves.toMatchObject({
			open: null,
			saved: { id: draftId },
		});
	});

	it("Use my plan next month starts from the saved plan", async () => {
		const fill = await getFillFromTargets(s.user.id, b.next);
		expect(fill.lines.map((l) => [l.envelopeId, l.amount.minor, l.step])).toEqual([
			[b.id("Rent"), 50_000, "PLAN"],
			[b.id("Dining"), 20_000, "PLAN"],
		]);
		expect(fill.rest).toEqual(usd(30_000));
	});

	it("undo of Apply makes it a draft again", async () => {
		const r = await forUser(s.user.id).apply(unapplyDraftMutation, { draftId });
		expect(r.value.draft.status).toBe("OPEN");
		await forUser(s.user.id).apply(applyDraftMutation, { draftId });
	});

	it("Fund it now writes one PLAN_APPLY batch of 70,000; its undo gives it back", async () => {
		const batchId = randomUUID();
		const r = await forUser(s.user.id).apply(fundPlanNowMutation, { draftId, batchId });
		expect(r.value.movement?.toAssign).toEqual({ before: usd(100_000), after: usd(30_000) });
		const rows = await adminDb.budgetMovement.findMany({ where: { batchId } });
		expect(rows.map((x) => [x.kind, x.month, x.toEnvelopeId, Number(x.amount)])).toEqual(
			expect.arrayContaining([
				["PLAN_APPLY", b.next, b.id("Rent"), 500],
				["PLAN_APPLY", b.next, b.id("Dining"), 200],
			]),
		);
		const sides = await invariantAt(s.user.id);
		expect(sides.budget).toBe(sides.ledger);
		await forUser(s.user.id).apply(undoMovements, { id: randomUUID(), target: { batchId } });
		expect((await getMonth(s.user.id))?.toAssign.amount).toEqual(usd(100_000));
	});

	it("a draft whose month passed previews as stale and cannot be applied", async () => {
		const old = randomUUID();
		await adminDb.budgetDraft.create({
			data: { id: old, bookId: b.bookId, month: b.c, kind: "PLAN", createdById: s.user.id },
		});
		await expect(draftsApi.preview(s.user.id, old)).resolves.toMatchObject({ stale: true, envelopes: [] });
		await expect(forUser(s.user.id).apply(applyDraftMutation, { draftId: old })).rejects.toThrow(/passed/);
	});
});

describe("What if writes only its moves (D54)", () => {
	it("refuses a move beyond what Dining holds; writes a 5,000 move, never the pretend expense", async () => {
		const s = await seedUser();
		const b = await book(s);
		const save = (moves: Array<{ from: string | null; to: string | null; amountMinor: number }>) =>
			draftsApi.save(s.user.id, {
				id: randomUUID(),
				kind: "WHAT_IF",
				month: b.c,
				lines: [],
				moves: moves.map((m) => ({ id: randomUUID(), ...m })),
				expectedIn: [],
				pretend: [{ id: randomUUID(), kind: "OUT", categoryId: s.dining, envelopeId: null, amountMinor: 5_000 }],
			});
		const big = await save([{ from: b.id("Dining"), to: b.id("Rent"), amountMinor: 30_000 }]);
		await expect(
			forUser(s.user.id).apply(applyDraftMutation, { draftId: big.id, batchId: randomUUID() }),
		).rejects.toThrow(/more than the envelope holds/);
		const ok = await save([{ from: null, to: b.id("Dining"), amountMinor: 5_000 }]);
		const p = await draftsApi.preview(s.user.id, ok.id);
		expect(p.envelopes.map((e) => [e.envelopeId, e.left.after.minor])).toEqual([[b.id("Dining"), 0]]);
		const batchId = randomUUID();
		await forUser(s.user.id).apply(applyDraftMutation, { draftId: ok.id, batchId });
		const rows = await adminDb.budgetMovement.findMany({ where: { batchId } });
		expect(rows.map((r) => [r.kind, Number(r.amount)])).toEqual([["PLAN_APPLY", 50]]);
		await expect(adminDb.expense.count({ where: { userId: s.user.id, direction: "OUT" } })).resolves.toBe(0);
	});
});

describe("figure budget.planCost", () => {
	it("plan cost 70,000, essentials 50,000, runway 2.0 months, no typical income yet", async () => {
		const s = await seedUser();
		await book(s);
		const pc = await getPlanCost(s.user.id, {});
		expect(pc).toMatchObject({
			cost: usd(70_000),
			essentialCost: usd(50_000),
			runway: { available: usd(100_000), tenths: 20 },
			typicalIncome: null,
			closedMonths: 0,
		});
		const f = await readFigures(s.user.id, ["budget.planCost", "budget.typicalIncome"]);
		expect(f.get("budget.planCost")).toEqual([usd(70_000)]);
		expect(f.get("budget.typicalIncome")).toBeNull();
	});
});

describe("figure budget.typicalIncome", () => {
	it("is the median budget income of the last 3 closed months: 200,000", async () => {
		const s = await augustBook();
		for (const [amount, day] of [[1_000, "2026-08-05"], [3_000, "2026-09-05"], [2_000, "2026-10-05"]] as const)
			await addRow(s.user.id, { amount, direction: "IN", inType: "INCOME" }, at(day));
		const now = at("2026-11-04");
		await getMonth(s.user.id, undefined, now);
		const pc = await userTransaction(adminDb, s.user.id, (tx) => planCostIn(tx, s.user.id, {}, now));
		expect(pc).toMatchObject({ typicalIncome: usd(200_000), closedMonths: 3 });
	});
});

describe("group targets (SPEC §5.9)", () => {
	it("an amount target fills Dining's own target first, the rest to the main envelope; a % target sizes on money in", async () => {
		const s = await seedUser();
		const b = await book(s);
		const r = await putGroupTarget(s.user.id, {
			groupId: b.group("Spending"),
			target: { kind: "AMOUNT", amountMinor: 30_000 },
			mainEnvelopeId: b.id("Spending"),
		});
		expect(r.previous).toEqual({ target: { kind: "NONE" }, mainEnvelopeId: null });
		await putGroupTarget(s.user.id, {
			groupId: b.group("Bills"),
			target: { kind: "PERCENT_OF_INCOME", basisPoints: 5_000 },
		});
		await addRow(s.user.id, { amount: 2_000, direction: "IN", inType: "INCOME" });
		const m = await getMonth(s.user.id);
		const g = (name: string) => m?.groups.find((x) => x.id === b.group(name))?.target;
		expect(g("Spending")).toMatchObject({
			amount: usd(30_000),
			need: usd(30_000),
			mainEnvelopeId: b.id("Spending"),
			mainExtra: usd(10_000),
		});
		expect(g("Bills")).toMatchObject({
			amount: usd(100_000),
			plannedBp: 5_000,
			baseSource: "THIS_MONTH",
			mainEnvelopeId: null,
			mainExtra: usd(0),
		});
	});
});

describe("year view (D9, D66)", () => {
	it("months before the start show spending only; closed months come from the engine", async () => {
		const s = await augustBook();
		await addRow(s.user.id, { amount: 40, categoryId: s.dining }, at("2026-07-10"));
		const y = await getYearView(s.user.id, 2026, at("2026-10-23"));
		expect(y.months.map((x) => x.state)).toEqual([
			...Array(7).fill("BEFORE_START"),
			"CLOSED",
			"CLOSED",
			"OPEN",
			"NEXT",
			"LATER",
		]);
		const dining = y.envelopes.find((e) => e.id === s.diningEnv);
		expect(dining?.cells.slice(6, 9)).toEqual([
			{ month: 202607, assigned: null, spent: usd(4_000), left: null },
			{ month: 202608, assigned: usd(30_000), spent: usd(10_000), left: usd(20_000) },
			{ month: 202609, assigned: usd(0), spent: usd(5_000), left: usd(15_000) },
		]);
	});
});

describe("setup with the P5 styles", () => {
	it("Save first writes its rules and the Spending sweep; the rules run on the next money in", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			style: "SAVE_FIRST",
			startingMoneyMinor: 0,
			timeZone: "UTC",
			groups: [
				{ key: "savings", name: "Savings", role: "SAVINGS" },
				{ key: "spending", name: "Spending", role: "SPENDING" },
			],
			envelopes: [
				{ key: "savings", name: "Savings", groupKey: "savings", kind: "SAVINGS", isDefault: false, categoryIds: [] },
				{ key: "spending", name: "Spending", groupKey: "spending", kind: "MONTHLY", isDefault: true, categoryIds: [], sweepToKey: "savings" },
			],
			rules: [
				{ name: "Savings first", match: { kind: "ANY" }, action: { kind: "PERCENT", basisPoints: 2_000 }, envelopeKey: "savings" },
				{ name: "The rest", match: { kind: "ANY" }, action: { kind: "REMAINDER" }, envelopeKey: "spending" },
			],
		});
		const bk = await adminDb.budgetBook.findFirstOrThrow({ where: { createdById: s.user.id }, include: { envelopes: true } });
		const id = (n: string) => bk.envelopes.find((e) => e.name === n)?.id;
		expect(bk.envelopes.find((e) => e.name === "Spending")).toMatchObject({ leftoverRule: "SWEEP", leftoverSweepToId: id("Savings") });
		await addRow(s.user.id, { amount: 1_000, direction: "IN", inType: "INCOME" });
		const m = await getMonth(s.user.id);
		const assigned = (n: string) => m?.groups.flatMap((g) => g.envelopes).find((e) => e.id === id(n))?.assigned.minor;
		expect([assigned("Savings"), assigned("Spending"), m?.toAssign.amount.minor]).toEqual([20_000, 80_000, 0]);
	});

	it("50/30/20 stores percent group targets", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			style: "FIFTY_THIRTY_TWENTY",
			timeZone: "UTC",
			groups: [
				{ key: "needs", name: "Needs", role: "BILLS", target: { kind: "PERCENT_OF_INCOME", basisPoints: 5_000 } },
				{ key: "wants", name: "Wants", role: "SPENDING", target: { kind: "PERCENT_OF_INCOME", basisPoints: 3_000 } },
			],
			envelopes: [
				{ key: "needs", name: "Needs", groupKey: "needs", kind: "MONTHLY", isDefault: false, categoryIds: [s.rent] },
				{ key: "wants", name: "Wants", groupKey: "wants", kind: "MONTHLY", isDefault: true, categoryIds: [] },
			],
		});
		const groups = await adminDb.envelopeGroup.findMany({
			where: { book: { createdById: s.user.id } },
			orderBy: { sortOrder: "asc" },
		});
		expect(groups.map((g) => [g.targetKind, Number(g.targetValue)])).toEqual([
			["PERCENT_OF_INCOME", 50],
			["PERCENT_OF_INCOME", 30],
		]);
	});
});
