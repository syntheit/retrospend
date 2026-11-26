/**
 * A category merge and its undo when a row's stored stamp is at or after the
 * merge's own clock. The database keeps the larger of the stamp a write sets
 * and the row's old stamp plus a millisecond (stamp_moves), so a row stamped
 * in the same millisecond as the merge, or by a clock ahead of this server's,
 * stores something other than the merge's stamp. Each holder reads back what
 * its write stored, per row, and the undo compares each row with that, so
 * every moved row is held and every one comes back.
 *
 * Each case holds two rows: one stamped exactly at the merge clock (the same
 * millisecond) and one an hour past it (this server's clock is behind).
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import { forUser } from "~/server/services/preview";
import { seedUser, setupInput } from "../envelope/__tests__/pg-fixture";
import { setupEnvelopeBook } from "../envelope/setup.mutation";
import {
	arsUser,
	category,
	run,
	sharedTx,
	shareOf,
	undo,
} from "./__tests__/merge-kit";

const HOUR = 3_600_000;
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

/** The merge's clock, frozen: the first row is stamped at it, the second an hour ahead. */
function clock() {
	const now = new Date(Math.floor(Date.now() / 1000) * 1000);
	vi.useFakeTimers({ toFake: ["Date"], now });
	return { now, ahead: plus(now, HOUR) };
}
afterEach(() => vi.useRealTimers());

const stampsOf = (rows: { updatedAt: Date }[]) =>
	rows.map((r) => r.updatedAt.getTime());

/** What each row must store: its own stamp plus a millisecond, never the merge's. */
const moved = (...stamps: Date[]) => stamps.map((s) => s.getTime() + 1);

async function bookFor() {
	const s = await seedUser();
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...setupInput(s),
		timeZone: "UTC",
	});
	const book = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: s.user.id },
		include: { envelopes: true },
	});
	const env = Object.fromEntries(book.envelopes.map((e) => [e.name, e.id]));
	return { ...s, book, env: env as Record<string, string> };
}

describe("rows stamped at or after the merge's clock", () => {
	it("expenses: both are held, keep their own stored stamps and come back", async () => {
		const me = await arsUser();
		const src = await category(me, "Cafe");
		const tgt = await category(me, "Food");
		const { now, ahead } = clock();
		const mk = (updatedAt: Date) =>
			fixtureDb.expense.create({
				data: {
					userId: me,
					title: "Lunch",
					amount: "10",
					currency: "USD",
					date: now,
					categoryId: src.id,
					amountInUSD: "10",
					exchangeRate: "1",
					pricingSource: "MANUAL",
					updatedAt,
				},
			});
		const [a, b] = [await mk(now), await mk(ahead)];

		const done = await run(me, src.id, tgt.id);

		expect(done.value.counts.expense).toEqual({ moved: 2, dropped: 0 });
		const after = await adminDb.expense.findMany({
			where: { id: { in: [a.id, b.id] } },
			orderBy: { updatedAt: "asc" },
		});
		expect(after.map((r) => r.categoryId)).toEqual([tgt.id, tgt.id]);
		expect(stampsOf(after)).toEqual(moved(now, ahead));

		await undo(me, done.value.stash);
		const back = await adminDb.expense.findMany({
			where: { id: { in: [a.id, b.id] } },
		});
		expect(back.map((r) => r.categoryId)).toEqual([src.id, src.id]);
	});

	it("recurring templates: both are held and come back", async () => {
		const me = await arsUser();
		const src = await category(me, "Cafe");
		const tgt = await category(me, "Food");
		const { now, ahead } = clock();
		const mk = (updatedAt: Date) =>
			fixtureDb.recurringTemplate.create({
				data: {
					userId: me,
					name: "Gym",
					amount: "20",
					categoryId: src.id,
					frequency: "MONTHLY",
					nextDueDate: new Date("2026-12-01T00:00:00Z"),
					updatedAt,
				},
			});
		const ids = [(await mk(now)).id, (await mk(ahead)).id];

		const done = await run(me, src.id, tgt.id);

		expect(done.value.counts.template).toEqual({ moved: 2, dropped: 0 });
		await undo(me, done.value.stash);
		const back = await adminDb.recurringTemplate.findMany({
			where: { id: { in: ids } },
		});
		expect(back.map((r) => r.categoryId)).toEqual([src.id, src.id]);
	});

	it("shared expenses: both are held, none is counted as dropped, and they come back", async () => {
		const me = await arsUser();
		const src = await category(me, "Cafe");
		const tgt = await category(me, "Food");
		const { now, ahead } = clock();
		const ids = [
			(await sharedTx(me, src.id, { updatedAt: now })).id,
			(await sharedTx(me, src.id, { updatedAt: ahead })).id,
		];

		const done = await run(me, src.id, tgt.id);

		expect(done.value.counts.sharedTransaction).toEqual({
			moved: 2,
			dropped: 0,
		});
		expect(done.value.setToNone).toBe(0);
		await undo(me, done.value.stash);
		const back = await adminDb.sharedTransaction.findMany({
			where: { id: { in: ids } },
		});
		expect(back.map((r) => r.categoryId)).toEqual([src.id, src.id]);
	});

	it("your shares: both are held and come back", async () => {
		const me = await arsUser();
		const other = await arsUser();
		const src = await category(me, "Cafe");
		const tgt = await category(me, "Food");
		const { now, ahead } = clock();
		const one = await sharedTx(other, null);
		const two = await sharedTx(other, null);
		const ids = [
			(await shareOf(one.id, me, src.id, { updatedAt: now })).id,
			(await shareOf(two.id, me, src.id, { updatedAt: ahead })).id,
		];

		const done = await run(me, src.id, tgt.id);

		expect(done.value.counts.share).toEqual({ moved: 2, dropped: 0 });
		await undo(me, done.value.stash);
		const back = await adminDb.splitParticipant.findMany({
			where: { id: { in: ids } },
		});
		expect(back.map((r) => r.categoryId)).toEqual([src.id, src.id]);
	});

	it("budgets: both are held and come back", async () => {
		const me = await arsUser();
		const src = await category(me, "Cafe");
		const tgt = await category(me, "Food");
		const { now, ahead } = clock();
		const mk = (period: string, updatedAt: Date) =>
			adminDb.budget.create({
				data: {
					userId: me,
					categoryId: src.id,
					period: new Date(period),
					amount: "50",
					updatedAt,
				},
			});
		const ids = [
			(await mk("2026-10-01T00:00:00Z", now)).id,
			(await mk("2026-11-01T00:00:00Z", ahead)).id,
		];

		const done = await run(me, src.id, tgt.id);

		expect(done.value.counts.budget).toEqual({ moved: 2, dropped: 0 });
		await undo(me, done.value.stash);
		const back = await adminDb.budget.findMany({ where: { id: { in: ids } } });
		expect(back.map((r) => r.categoryId)).toEqual([src.id, src.id]);
	});

	it("income rules: both are held and come back", async () => {
		const b = await bookFor();
		const gigs = await category(b.user.id, "Gigs", { kind: "INCOME" });
		const pay = await category(b.user.id, "Pay", { kind: "INCOME" });
		const { now, ahead } = clock();
		const mk = (sortOrder: number, updatedAt: Date) =>
			fixtureDb.incomeRule.create({
				data: {
					id: randomUUID(),
					bookId: b.book.id,
					sortOrder,
					name: `Gigs to Dining ${sortOrder}`,
					matchKind: "CATEGORY",
					matchValue: gigs.id,
					action: "REMAINDER",
					envelopeId: b.env.Dining as string,
					updatedAt,
				},
			});
		const ids = [(await mk(0, now)).id, (await mk(1, ahead)).id];

		const done = await run(b.user.id, gigs.id, pay.id);

		expect(done.value.counts.incomeRule).toEqual({ moved: 2, dropped: 0 });
		await undo(b.user.id, done.value.stash);
		const back = await adminDb.incomeRule.findMany({
			where: { id: { in: ids } },
		});
		expect(back.map((r) => r.matchValue)).toEqual([gigs.id, gigs.id]);
	});

	it("budget drafts: both are held and come back", async () => {
		const b = await bookFor();
		const src = await category(b.user.id, "Cafe");
		const tgt = await category(b.user.id, "Food");
		const { now, ahead } = clock();
		const mk = (month: number, updatedAt: Date) =>
			adminDb.budgetDraft.create({
				data: {
					id: randomUUID(),
					bookId: b.book.id,
					month,
					kind: "WHAT_IF",
					createdById: b.user.id,
					expectedIn: [
						{ id: "e1", templateId: null, categoryId: src.id, amountMinor: 100 },
					],
					pretend: [],
					updatedAt,
				},
			});
		const ids = [(await mk(202612, now)).id, (await mk(202701, ahead)).id];

		const done = await run(b.user.id, src.id, tgt.id);

		expect(done.value.counts.draft).toEqual({ moved: 2, dropped: 0 });
		await undo(b.user.id, done.value.stash);
		const back = await adminDb.budgetDraft.findMany({
			where: { id: { in: ids } },
		});
		expect(
			back.flatMap((d) =>
				(d.expectedIn as { categoryId: string }[]).map((r) => r.categoryId),
			),
		).toEqual([src.id, src.id]);
	});
});
