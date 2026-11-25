/**
 * What a category merge refuses and what its undo refuses, on a real
 * Postgres: a closed month is never written, an undo changes nothing unless
 * every row is still as the merge left it, and the events carry ids only.
 */
import { randomUUID } from "node:crypto";
import { SERVER_KEY_PREFIX } from "@retrospend/api-contract/common";
import { addMonths } from "@retrospend/domain/envelope/calendar";
import { budgetMonthOf, isoDateIn } from "@retrospend/domain/envelope/months";
import { describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { CsvService } from "~/server/services/csv.service";
import { forUser } from "~/server/services/preview";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import { addRow, seedUser, setupInput } from "../envelope/__tests__/pg-fixture";
import { getMonth } from "../envelope/read.service";
import { setupEnvelopeBook } from "../envelope/setup.mutation";
import {
	arsUser,
	category,
	expense,
	run,
	templateOf,
	undo,
} from "./__tests__/merge-kit";
import { budgetHolder } from "./holders-budget";

const stashRows = (userId: string, stash: string) =>
	adminDb.idempotencyKey.count({
		where: { userId, key: `${SERVER_KEY_PREFIX.undoStash}${stash}` },
	});

describe("an undo is refused as a whole, changing nothing", () => {
	async function merged() {
		const me = await arsUser();
		const src = await category(me, "Cafe");
		const tgt = await category(me, "Food");
		const row = await expense(me, src.id, 10);
		const other = await expense(me, src.id, 4);
		const tpl = await templateOf(me, src.id);
		const done = await run(me, src.id, tgt.id);
		return { me, src, tgt, row, other, tpl, stash: done.value.stash };
	}

	async function expectUntouched(m: Awaited<ReturnType<typeof merged>>) {
		await expect(
			fixtureDb.category.count({ where: { id: m.src.id } }),
		).resolves.toBe(0);
		await expect(
			fixtureDb.expense.count({ where: { categoryId: m.tgt.id } }),
		).resolves.toBe(2);
		await expect(stashRows(m.me, m.stash)).resolves.toBe(1);
	}

	it("when an expense was edited since", async () => {
		const m = await merged();
		await fixtureDb.expense.update({
			where: { id: m.row.id },
			data: { title: "Edited since" },
		});
		await expect(undo(m.me, m.stash)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		await expectUntouched(m);
	});

	it("when an expense was moved elsewhere since", async () => {
		const m = await merged();
		const third = await category(m.me, "Third");
		await fixtureDb.expense.update({
			where: { id: m.other.id },
			data: { categoryId: third.id },
		});
		await expect(undo(m.me, m.stash)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		await expect(
			fixtureDb.category.count({ where: { id: m.src.id } }),
		).resolves.toBe(0);
	});

	it("when a recurring template was edited since", async () => {
		const m = await merged();
		await fixtureDb.recurringTemplate.update({
			where: { id: m.tpl.id },
			data: { name: "Gym, new name" },
		});
		await expect(undo(m.me, m.stash)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		await expectUntouched(m);
	});

	it("when the target is gone", async () => {
		const m = await merged();
		await fixtureDb.category.delete({ where: { id: m.tgt.id } });
		await expect(undo(m.me, m.stash)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		await expect(
			fixtureDb.category.count({ where: { id: m.src.id } }),
		).resolves.toBe(0);
	});

	it("when the name was taken since, and a retry after the name is free works", async () => {
		const m = await merged();
		const taken = await category(m.me, "Cafe");
		await expect(undo(m.me, m.stash)).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Category name already exists",
		});
		await expectUntouched(m);
		await fixtureDb.category.update({
			where: { id: taken.id },
			data: { name: "Cafe, later" },
		});
		await undo(m.me, m.stash);
		await expect(
			fixtureDb.category.count({ where: { id: m.src.id } }),
		).resolves.toBe(1);
	});

	it("when a budget was moved with the category and then edited", async () => {
		const me = await arsUser();
		const src = await category(me, "Cafe");
		const tgt = await category(me, "Food");
		const budget = await adminDb.budget.create({
			data: {
				userId: me,
				categoryId: src.id,
				period: new Date("2026-11-01T00:00:00Z"),
				amount: "60",
			},
		});
		const done = await run(me, src.id, tgt.id);
		await adminDb.budget.update({
			where: { id: budget.id },
			data: { amount: "61" },
		});
		await expect(undo(me, done.value.stash)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		await expect(
			fixtureDb.category.count({ where: { id: src.id } }),
		).resolves.toBe(0);
	});

	it("when a budget for the source exists by the time the rows come back", async () => {
		const me = await arsUser();
		const src = await category(me, "Cafe");
		await adminDb.budget.create({
			data: {
				userId: me,
				categoryId: src.id,
				period: new Date("2026-11-01T00:00:00Z"),
				amount: "60",
			},
		});
		const ctx = (tx: Parameters<Parameters<typeof userTransaction>[2]>[0]) => ({
			tx,
			userId: me,
			sourceId: src.id,
			targetId: null,
			stamp: new Date(),
		});
		await expect(
			userTransaction(adminDb, me, (tx) =>
				budgetHolder.restore(ctx(tx), { ids: [], stamp: "", dropped: [] }),
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("when an envelope link of the target was changed since", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			timeZone: "UTC",
		});
		const book = await adminDb.budgetBook.findFirstOrThrow({
			where: { createdById: s.user.id },
			include: { envelopes: true },
		});
		const spending = book.envelopes.find((e) => e.name === "Spending");
		const snacks = await category(s.user.id, "Snacks");
		const treats = await category(s.user.id, "Treats");
		const dining = book.envelopes.find((e) => e.name === "Dining");
		const link = await adminDb.envelopeCategory.create({
			data: {
				bookId: book.id,
				envelopeId: dining?.id as string,
				categoryId: snacks.id,
			},
		});
		const done = await run(s.user.id, snacks.id, treats.id);
		await adminDb.envelopeCategory.update({
			where: { id: link.id },
			data: { envelopeId: spending?.id as string },
		});
		await expect(undo(s.user.id, done.value.stash)).rejects.toMatchObject({
			code: "CONFLICT",
		});
	});

	it("when a draft that was moved was edited since", async () => {
		const s = await seedUser();
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			timeZone: "UTC",
		});
		const book = await adminDb.budgetBook.findFirstOrThrow({
			where: { createdById: s.user.id },
		});
		const src = await category(s.user.id, "Cafe");
		const tgt = await category(s.user.id, "Food");
		const draft = await adminDb.budgetDraft.create({
			data: {
				id: randomUUID(),
				bookId: book.id,
				month: 202612,
				kind: "WHAT_IF",
				createdById: s.user.id,
				pretend: [{ id: "p", kind: "OUT", categoryId: src.id, amountMinor: 5 }],
			},
		});
		const done = await run(s.user.id, src.id, tgt.id);
		await adminDb.budgetDraft.update({
			where: { id: draft.id },
			data: { moves: [] },
		});
		await expect(undo(s.user.id, done.value.stash)).rejects.toMatchObject({
			code: "CONFLICT",
		});
	});

	it("two undos of one stash run once", async () => {
		const m = await merged();
		const results = await Promise.allSettled([
			undo(m.me, m.stash),
			undo(m.me, m.stash),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		await expect(
			fixtureDb.category.count({ where: { id: m.src.id } }),
		).resolves.toBe(1);
		await expect(
			fixtureDb.expense.count({ where: { categoryId: m.src.id } }),
		).resolves.toBe(2);
	});
});

describe("events carry ids and no name", () => {
	it("a merge, a delete and an undo append category.merged, category.deleted and category.undone", async () => {
		const me = await arsUser();
		const a = await category(me, "Secret name A");
		const b = await category(me, "Secret name B");
		const c = await category(me, "Secret name C");
		const merged = await run(me, a.id, b.id);
		const deleted = await run(me, c.id, null);
		await undo(me, merged.value.stash);

		const events = await adminDb.apiEvent.findMany({
			where: { userId: me },
			orderBy: { seq: "asc" },
		});
		expect(events.map((e) => [e.type, e.entityId])).toEqual([
			["category.merged", a.id],
			["category.deleted", c.id],
			["category.undone", a.id],
		]);
		expect(JSON.stringify(events.map((e) => e.payload))).not.toMatch(/Secret/);
		expect(deleted.value.mode).toBe("delete");
	});
});

describe("a pending import committed after the merge", () => {
	it("lands the row uncategorized when its category is gone", async () => {
		const made = await arsUser();
		const gone = await category(made, "Gone");
		await run(made, gone.id, null);
		const service = new CsvService(adminDb);
		await service.importExpensesFromRows(made, [
			{
				title: "Imported",
				amount: 10,
				currency: "USD",
				date: new Date("2026-10-20T12:00:00Z"),
				exchangeRate: 1,
				amountInUSD: 10,
				categoryId: gone.id,
			},
		]);
		await expect(
			fixtureDb.expense.findFirstOrThrow({
				where: { userId: made, title: "Imported" },
			}),
		).resolves.toMatchObject({ categoryId: null });
	});
});

const current = budgetMonthOf(isoDateIn(new Date(), "UTC"), [
	{ fromMonth: 0, startDay: 1 },
]);
const firstDay = (m: number) =>
	new Date(Date.UTC(Math.floor(m / 100), (m % 100) - 1, 1));
const midMonth = (m: number) =>
	new Date(Date.UTC(Math.floor(m / 100), (m % 100) - 1, 12, 12));

/** A USD book that started two months ago, so the two months before this one close on the first read. */
async function closedBook() {
	const s = await seedUser();
	const snacks = await category(s.user.id, "Snacks");
	const utilities = await category(s.user.id, "Utilities");
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...setupInput(s),
		timeZone: "UTC",
	});
	const book = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: s.user.id },
		include: { envelopes: true },
	});
	const env = Object.fromEntries(book.envelopes.map((e) => [e.name, e.id]));
	// Snacks files in Dining and Utilities in Rent, frozen into each close.
	await adminDb.envelopeCategory.createMany({
		data: [
			{ bookId: book.id, envelopeId: env.Dining as string, categoryId: snacks.id },
			{ bookId: book.id, envelopeId: env.Rent as string, categoryId: utilities.id },
		],
	});
	const start = addMonths(current, -2);
	await adminDb.budgetBook.update({
		where: { id: book.id },
		data: { startMonth: start, startDate: firstDay(start) },
	});
	await adminDb.bookPeriod.updateMany({
		where: { bookId: book.id },
		data: { fromMonth: start },
	});
	if (book.startingBalanceExpenseId)
		await fixtureDb.expense.update({
			where: { id: book.startingBalanceExpenseId },
			data: { date: firstDay(start) },
		});
	await addRow(s.user.id, { amount: 100, categoryId: s.dining }, midMonth(start));
	await addRow(s.user.id, { amount: 30, categoryId: snacks.id }, midMonth(start));
	await addRow(
		s.user.id,
		{ amount: 20, categoryId: utilities.id },
		midMonth(addMonths(current, -1)),
	);
	await getMonth(s.user.id);
	return { ...s, snacks, utilities, bookId: book.id, start };
}

const closedViews = async (b: Awaited<ReturnType<typeof closedBook>>) => ({
	views: JSON.stringify(
		await Promise.all(
			[b.start, addMonths(b.start, 1)].map(async (m) => (await getMonth(b.user.id, m))?.groups),
		),
	),
	closes: (
		await adminDb.monthClose.findMany({
			where: { bookId: b.bookId },
			orderBy: { month: "asc" },
		})
	).map((c) => ({
		month: c.month,
		summary: JSON.stringify(c.summary),
		carry: JSON.stringify((c.checkpoint as { carry?: unknown } | null)?.carry),
		totals: JSON.stringify(
			(c.checkpoint as { totals?: unknown } | null)?.totals,
		),
	})),
});

describe("closed months", () => {
	it("two categories a closed month filed in one envelope merge, and every closed month's figures and checkpoint stay as they were", async () => {
		const b = await closedBook();
		const before = await closedViews(b);
		expect(before.closes).toHaveLength(2);

		const done = await run(b.user.id, b.snacks.id, b.dining);

		expect(done.value.counts.expense.moved).toBe(1);
		await getMonth(b.user.id);
		expect(await closedViews(b)).toEqual(before);
	});

	it("is refused, writing nothing, when a closed month filed the rows in another envelope", async () => {
		const b = await closedBook();
		const before = await closedViews(b);
		await expect(run(b.user.id, b.utilities.id, b.dining)).rejects.toMatchObject({
			cause: { problem: "category_closed_month" },
		});
		// A delete files the rows in Everything else, which is another envelope too.
		await expect(run(b.user.id, b.utilities.id, null)).rejects.toMatchObject({
			cause: { problem: "category_closed_month" },
		});
		await expect(
			fixtureDb.category.count({ where: { id: b.utilities.id } }),
		).resolves.toBe(1);
		expect(await closedViews(b)).toEqual(before);
	});

	it("passes when the category has no row in a closed month, and its open rows follow the target's envelope", async () => {
		const b = await closedBook();
		const idle = await category(b.user.id, "Idle");
		await adminDb.envelopeCategory.create({
			data: {
				bookId: b.bookId,
				envelopeId: (
					await adminDb.envelope.findFirstOrThrow({
						where: { bookId: b.bookId, name: "Rent" },
					})
				).id,
				categoryId: idle.id,
			},
		});
		await addRow(b.user.id, { amount: 5, categoryId: idle.id }, new Date());
		const done = await run(b.user.id, idle.id, b.dining);
		expect(done.value.rerouted).toHaveLength(1);
	});
});
