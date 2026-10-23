/**
 * The stable past on Postgres (SPEC §5.5, §5.13): checkpoints, the late
 * window (C17) and recalculation after it (C16), with the budget_dirty
 * triggers that tell a read what changed. Expected values by hand, USD
 * book, minor units (cents), started August 2026, UTC:
 *
 *   start money 1,000.00 on Aug 1; Dining assigned 300.00 in August,
 *   100.00 spent on Aug 12, 50.00 on Sep 12 (Carry).
 *   Dining Left: Aug 200.00, Sep 150.00, Oct 150.00.
 *   To assign in November: 1,000.00 - 300.00 = 700.00.
 *
 *   C17, Nov 3: a 30.00 Dining dinner from Oct 30. October ended 4 days
 *   ago: its summary becomes Dining Left 120.00 in place, 1 late entry,
 *   revision 1, no change item. November's Dining Left is 120.00.
 *
 *   C16, Nov 20 (October's window ended Nov 7): the Aug 12 expense is
 *   deleted. August, September and October now end at 300.00, 250.00 and
 *   220.00: each gets revision 2 and the change "from August, Dining
 *   +100.00 today, To assign +0".
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import {
	addRow,
	invariantAt,
	seedUser,
	setupInput,
} from "./__tests__/pg-fixture";
import { loadCloseRows } from "./close-rows";
import { computeBook, sumLeft } from "./engine";
import { loadBook } from "./inputs";
import { getMonth, getMonthSummary } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";

const at = (iso: string) => new Date(`${iso}T15:00:00Z`);

async function augustBook() {
	const s = await seedUser();
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...setupInput(s),
		timeZone: "UTC",
	});
	const book = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: s.user.id },
		include: { envelopes: true },
	});
	await adminDb.budgetBook.update({
		where: { id: book.id },
		data: { startMonth: 202608, startDate: new Date("2026-08-01T00:00:00Z") },
	});
	await adminDb.bookPeriod.updateMany({
		where: { bookId: book.id },
		data: { fromMonth: 202608 },
	});
	await adminDb.expense.update({
		where: { id: book.startingBalanceExpenseId as string },
		data: { date: new Date("2026-08-01T00:00:00Z") },
	});
	const ids = Object.fromEntries(book.envelopes.map((e) => [e.name, e.id]));
	await adminDb.budgetMovement.create({
		data: {
			id: randomUUID(),
			bookId: book.id,
			month: 202608,
			toEnvelopeId: ids.Dining,
			amount: 300,
			kind: "ASSIGN",
			actorUserId: s.user.id,
		},
	});
	const aug = await addRow(
		s.user.id,
		{ amount: 100, categoryId: s.dining },
		at("2026-08-12"),
	);
	await addRow(s.user.id, { amount: 50, categoryId: s.dining }, at("2026-09-12"));
	return { ...s, bookId: book.id, diningEnv: ids.Dining as string, aug };
}

const leftOf = (m: Awaited<ReturnType<typeof getMonth>>, id: string) =>
	m?.groups.flatMap((g) => g.envelopes).find((e) => e.id === id)?.left.minor;

const diningLeft = (
	s: Awaited<ReturnType<typeof getMonthSummary>>,
	id: string,
) => s?.summary.envelopes.find((e) => e.id === id)?.left;

describe("checkpoints, the late window and recalculation on Postgres", () => {
	let b: Awaited<ReturnType<typeof augustBook>>;

	beforeAll(async () => {
		b = await augustBook();
	});

	it("the first read on Nov 3 closes August to October, each with a checkpoint, and clears the marks", async () => {
		const nov = await getMonth(b.user.id, undefined, at("2026-11-03"));
		expect(leftOf(nov, b.diningEnv)).toBe(15_000);
		expect(nov?.toAssign.amount.minor).toBe(70_000);
		const closes = await adminDb.monthClose.findMany({
			where: { bookId: b.bookId },
			orderBy: { month: "asc" },
		});
		expect(closes.map((c) => c.month)).toEqual([202608, 202609, 202610]);
		expect(closes.every((c) => c.checkpoint !== null)).toBe(true);
		await expect(
			adminDb.budgetDirty.count({ where: { bookId: b.bookId } }),
		).resolves.toBe(0);
	});

	it("an expense write leaves a mark from its budget month (trigger)", async () => {
		const row = await addRow(
			b.user.id,
			{ amount: 30, categoryId: b.dining },
			at("2026-10-30"),
		);
		const marks = await adminDb.budgetDirty.findMany({
			where: { bookId: b.bookId },
		});
		expect(marks.map((m) => m.fromMonth)).toEqual([202610]);
		expect(row.id).toBeTruthy();
	});

	it("C17: inside the late window October is updated in place; no new revision, no change", async () => {
		const nov = await getMonth(b.user.id, undefined, at("2026-11-03"));
		expect(leftOf(nov, b.diningEnv)).toBe(12_000);
		const oct = await getMonthSummary(b.user.id, 202610, at("2026-11-03"));
		expect(diningLeft(oct, b.diningEnv)).toBe(12_000);
		expect(oct?.revision).toBe(1);
		expect(oct?.lateEntries).toBe(1);
		expect(oct?.change).toBeNull();
	});

	it("a pass from the checkpoint gives exactly the full pass", async () => {
		const both = await userTransaction(adminDb, b.user.id, async (tx) => {
			const now = at("2026-11-03");
			const fast = await loadBook(tx, b.user.id, { now });
			const full = await loadBook(tx, b.user.id, { now, needFrom: 202608 });
			return { fast, full };
		});
		expect(both.fast?.checkpoint?.month).toBe(202609);
		expect(both.full?.checkpoint).toBeNull();
		const fast = computeBook(both.fast?.input as never);
		const full = computeBook(both.full?.input as never);
		for (const m of [202610, 202611, 202612]) {
			expect(fast.toAssign(m)).toEqual(full.toAssign(m));
			expect(sumLeft(fast, m)).toBe(sumLeft(full, m));
		}
	});

	it("C16: after the window, deleting the August dinner revises every closed month once, with today's effect", async () => {
		await adminDb.expense.delete({ where: { id: b.aug.id } });
		const now = at("2026-11-20");
		// Two first reads at once revise once (the book lock).
		await Promise.all([
			getMonth(b.user.id, undefined, now),
			getMonth(b.user.id, undefined, now),
		]);
		const rows = await userTransaction(adminDb, b.user.id, (tx) =>
			loadCloseRows(tx, b.bookId),
		);
		expect(rows.map((r) => r.revision)).toEqual([2, 2, 2]);
		expect(
			rows.map(
				(r) => r.summary.envelopes.find((e) => e.id === b.diningEnv)?.left,
			),
		).toEqual([30_000, 25_000, 22_000]);
		const aug = await getMonthSummary(b.user.id, 202608, now);
		expect(aug?.change).toMatchObject({
			earliestMonth: 202608,
			toAssign: { minor: 0, currency: "USD" },
			envelopes: [{ id: b.diningEnv, delta: { minor: 10_000, currency: "USD" } }],
		});
		const nov = await getMonth(b.user.id, undefined, now);
		expect(leftOf(nov, b.diningEnv)).toBe(22_000);
		expect(nov?.toAssign.amount.minor).toBe(70_000);
		// 70,000 + 22,000 held = 100,000 in - 5,000 - 3,000 spent.
		await expect(invariantAt(b.user.id, now)).resolves.toEqual({
			budget: 92_000,
			ledger: 92_000,
		});
	});

	it("a read with nothing changed revises nothing", async () => {
		await getMonth(b.user.id, undefined, at("2026-11-21"));
		const rows = await adminDb.monthClose.findMany({
			where: { bookId: b.bookId },
		});
		expect(rows.every((r) => r.revision === 2)).toBe(true);
	});

	it("RLS: another user sees none of this book's marks and cannot write one", async () => {
		await addRow(b.user.id, { amount: 1 }, at("2026-10-05"));
		const other = await seedUser();
		await expect(
			other.db.budgetDirty.count({ where: { bookId: b.bookId } }),
		).resolves.toBe(0);
		await expect(
			other.db.budgetDirty.create({
				data: { bookId: b.bookId, fromMonth: 202608 },
			}),
		).rejects.toThrow();
		await expect(
			adminDb.budgetDirty.count({ where: { bookId: b.bookId } }),
		).resolves.toBe(1);
	});

	it("a rate for the book currency with none before it marks the whole book", async () => {
		const s = await seedUser();
		await adminDb.user.update({
			where: { id: s.user.id },
			data: { homeCurrency: "XAF" },
		});
		const bookId = randomUUID();
		await adminDb.budgetBook.create({
			data: {
				id: bookId,
				currency: "XAF",
				startDate: new Date("2026-08-01T00:00:00Z"),
				startMonth: 202608,
				createdById: s.user.id,
			},
		});
		await adminDb.exchangeRate.create({
			data: { date: at("2026-09-10"), currency: "XAF", type: "official", rate: 600 },
		});
		await adminDb.exchangeRate.create({
			data: { date: at("2026-10-10"), currency: "XAF", type: "official", rate: 601 },
		});
		const marks = await adminDb.budgetDirty.findMany({ where: { bookId } });
		expect(marks.map((m) => m.fromMonth).sort()).toEqual([0, 202610]);
	});
});

describe("budget_checkpoints migration", () => {
	it("applies twice without error (idempotent)", async () => {
		const sql = readFileSync(
			join(
				process.cwd(),
				"prisma/migrations/20261025100000_budget_checkpoints/migration.sql",
			),
			"utf8",
		);
		const client = new Client({ connectionString: process.env.DATABASE_URL });
		await client.connect();
		try {
			await client.query(sql);
			await client.query(sql);
		} finally {
			await client.end();
		}
	});
});
