/**
 * Category delete and merge on a real Postgres, through RLS: every holder of
 * the category moves and comes back, with an ARS home and rows booked at the
 * blue rate (1 USD = 1,545 ARS). Expected values are worked out by hand.
 */
import { randomUUID } from "node:crypto";
import type { TRPCError } from "@trpc/server";
import { beforeAll, describe, expect, it } from "vitest";
import { problemCode } from "~/server/api/error-formatter";
import { categoriesRouter } from "~/server/api/routers/categories";
import { createCallerFactory } from "~/server/api/trpc";
import { forUser } from "~/server/services/preview";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { seedUser, setupInput } from "../envelope/__tests__/pg-fixture";
import { getMonth } from "../envelope/read.service";
import { setupEnvelopeBook } from "../envelope/setup.mutation";
import {
	arsUser,
	BLUE,
	category,
	dry,
	expense,
	ids,
	run,
	sharedTx,
	shareOf,
	templateOf,
	undo,
} from "./__tests__/merge-kit";

describe("merge moves every row the category holds", () => {
	let me: string;
	beforeAll(async () => {
		me = await arsUser();
	});

	it("moves expenses, income, a fee, a spread parent and its parts, and leaves each analytics flag as it was", async () => {
		const food = await category(me, "Food");
		const cafe = await category(me, "Cafe");
		// The target holds spending out of analytics by default: a merge is a
		// consolidation, not a new categorization, so no moved row takes it.
		await fixtureDb.category.update({
			where: { id: food.id },
			data: { excludeByDefault: true },
		});
		const kept = await expense(me, cafe.id, 10, { excludeFromAnalytics: true });
		const counted = await expense(me, cafe.id, 4, {
			excludeFromAnalytics: false,
		});
		const income = await expense(me, cafe.id, 3, {
			direction: "IN",
			inType: "INCOME",
		});
		const fee = await expense(me, cafe.id, 1);
		// A transfer's fee: an account leg names the row, so an edit or a delete would not reach it.
		const transfer = await adminDb.transfer.create({
			data: {
				userId: me,
				kind: "TRANSFER",
				date: new Date(),
				fromAmount: "100",
				fromCurrency: "USD",
				toAmount: "100",
				toCurrency: "USD",
				feeExpenseId: fee.id,
			},
		});
		await adminDb.accountLeg.create({
			data: {
				userId: me,
				currency: "USD",
				amount: "-1",
				date: new Date(),
				source: "FEE",
				transferId: transfer.id,
				expenseId: fee.id,
			},
		});
		const parent = await expense(me, cafe.id, 12, { isAmortizedParent: true });
		const parts = await Promise.all(
			[1, 2].map(() =>
				expense(me, cafe.id, 6, {
					isAmortizedChild: true,
					parentId: parent.id,
				}),
			),
		);
		const all = [kept, counted, income, fee, parent, ...parts];

		const done = await run(me, cafe.id, food.id);

		expect(done.value.counts.expense).toEqual({ moved: 7, dropped: 0 });
		const rows = await fixtureDb.expense.findMany({
			where: { id: { in: all.map((r) => r.id) } },
			orderBy: { id: "asc" },
		});
		expect(rows.every((r) => r.categoryId === food.id)).toBe(true);
		const flag = (id: string) =>
			rows.find((r) => r.id === id)?.excludeFromAnalytics;
		expect(flag(kept.id)).toBe(true);
		expect(flag(counted.id)).toBe(false);
		// Booked at blue: 10 USD x 1,545 and 4 USD x 1,545, untouched.
		expect(rows.find((r) => r.id === kept.id)?.homeAmount?.toFixed()).toBe(
			"15450",
		);
		expect(rows.find((r) => r.id === counted.id)?.homeAmount?.toFixed()).toBe(
			"6180",
		);
		await expect(
			fixtureDb.category.count({ where: { id: cafe.id } }),
		).resolves.toBe(0);
	});

	it("previews the same merge without writing and says spent does not change, per currency", async () => {
		const own = await arsUser();
		const food = await category(own, "Dining");
		const bar = await category(own, "Bar");
		// Pesos at blue: 15,450 and 6,180 ARS are USD 10 and USD 4, and a dollar row beside them.
		for (const pesos of [15450, 6180])
			await expense(own, bar.id, pesos, {
				currency: "ARS",
				exchangeRate: new Prisma.Decimal(BLUE),
				amountInUSD: new Prisma.Decimal(pesos / BLUE),
				homeRate: new Prisma.Decimal(1),
				homeAmount: new Prisma.Decimal(pesos),
			});
		await expense(own, bar.id, 10);

		const preview = await dry(own, bar.id, food.id);

		expect(preview.value.counts.expense.moved).toBe(3);
		expect(preview.changes.find((c) => c.id === "spent")).toBeUndefined();
		const spent = preview.unchanged.find((u) => u.id === "spent");
		// ARS 21,630 (15,450 + 6,180) and USD 10, never added together.
		expect(spent?.value).toEqual(
			expect.arrayContaining([
				{ minor: 2_163_000, currency: "ARS" },
				{ minor: 1_000, currency: "USD" },
			]),
		);
		expect(spent?.value).toHaveLength(2);
		await expect(
			fixtureDb.category.count({ where: { id: bar.id } }),
		).resolves.toBe(1);
		await expect(
			fixtureDb.expense.count({ where: { categoryId: bar.id } }),
		).resolves.toBe(3);
	});

	it("moves recurring templates, income rows between income categories, and refuses a mixed pair", async () => {
		const salary = await category(me, "Salary", { kind: "INCOME" });
		const gigs = await category(me, "Gigs", { kind: "INCOME" });
		const spending = await category(me, "Misc");
		const pay = await expense(me, gigs.id, 100, {
			direction: "IN",
			inType: "INCOME",
		});
		const tpl = await templateOf(me, gigs.id);

		for (const [from, to] of [
			[gigs.id, spending.id],
			[spending.id, salary.id],
		] as const)
			await expect(run(me, from, to)).rejects.toMatchObject({
				problem: "category_kind_mismatch",
			});
		await expect(
			fixtureDb.category.count({ where: { id: gigs.id } }),
		).resolves.toBe(1);

		await run(me, gigs.id, salary.id);
		await expect(
			fixtureDb.expense.findUniqueOrThrow({ where: { id: pay.id } }),
		).resolves.toMatchObject({ categoryId: salary.id, direction: "IN" });
		await expect(
			fixtureDb.recurringTemplate.findUniqueOrThrow({ where: { id: tpl.id } }),
		).resolves.toMatchObject({ categoryId: salary.id });
	});

	it("a delete with no target leaves rows uncategorized and the undo puts the category and rows back", async () => {
		const gone = await category(me, "Gone", { icon: "tag", isFixed: false });
		const row = await expense(me, gone.id, 2);
		const done = await run(me, gone.id, null);

		await expect(
			fixtureDb.expense.findUniqueOrThrow({ where: { id: row.id } }),
		).resolves.toMatchObject({ categoryId: null });
		expect(done.value).toMatchObject({ mode: "delete", targetId: null });

		const back = await undo(me, done.value.stash);
		expect(back.value).toMatchObject({ id: gone.id, mode: "delete" });
		await expect(
			fixtureDb.category.findUniqueOrThrow({ where: { id: gone.id } }),
		).resolves.toMatchObject({ name: "Gone", icon: "tag", color: "blue" });
		await expect(
			fixtureDb.expense.findUniqueOrThrow({ where: { id: row.id } }),
		).resolves.toMatchObject({ categoryId: gone.id });
	});

	it("a merge and its undo return every row to where it was, others untouched", async () => {
		const a = await category(me, "A");
		const b = await category(me, "B");
		const mine = await Promise.all([1, 2, 3].map((n) => expense(me, a.id, n)));
		const theirs = await expense(me, b.id, 9);

		const done = await run(me, a.id, b.id);
		await undo(me, done.value.stash);

		const rows = await fixtureDb.expense.findMany({
			where: { categoryId: a.id },
		});
		expect(ids(rows)).toEqual(ids(mine));
		await expect(
			fixtureDb.expense.findUniqueOrThrow({ where: { id: theirs.id } }),
		).resolves.toMatchObject({ categoryId: b.id });
	});

	it("an unknown, foreign or same category is refused before anything moves", async () => {
		const mine = await category(me, "Mine");
		const other = await arsUser();
		const theirs = await category(other, "Theirs");
		await expect(run(me, randomUUID(), null)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(run(me, theirs.id, null)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(run(me, mine.id, theirs.id)).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		await expect(run(me, mine.id, mine.id)).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		await expect(
			fixtureDb.category.count({ where: { id: mine.id } }),
		).resolves.toBe(1);
	});
});

describe("shared expenses and shares", () => {
	it("moves the caller's own shares, keeps the source of the pick and any lock, and counts what it cannot edit", async () => {
		const me = await arsUser();
		const bob = await arsUser();
		const src = await category(me, "Trips");
		const tgt = await category(me, "Travel");
		// Mine: created by me, locked by a period close, one share of mine picked by me.
		const mineTx = await sharedTx(me, src.id, { isLocked: true });
		const myShare = await shareOf(mineTx.id, me, src.id, {
			categorySource: "PROJECT",
		});
		// Bob's, in my category by a raw write: I can read it (I am on it) but not write it.
		const bobsTx = await sharedTx(bob, src.id);
		await shareOf(bobsTx.id, me, null);

		const done = await run(me, src.id, tgt.id);

		expect(done.value.counts.sharedTransaction).toEqual({
			moved: 1,
			dropped: 1,
		});
		expect(done.value.setToNone).toBe(1);
		await expect(
			fixtureDb.sharedTransaction.findUniqueOrThrow({
				where: { id: mineTx.id },
			}),
		).resolves.toMatchObject({ categoryId: tgt.id, isLocked: true });
		await expect(
			fixtureDb.splitParticipant.findUniqueOrThrow({
				where: { id: myShare.id },
			}),
		).resolves.toMatchObject({ categoryId: tgt.id, categorySource: "PROJECT" });
		// Bob's row went to no category with the category.
		await expect(
			fixtureDb.sharedTransaction.findUniqueOrThrow({
				where: { id: bobsTx.id },
			}),
		).resolves.toMatchObject({ categoryId: null });

		await undo(me, done.value.stash);
		await expect(
			fixtureDb.sharedTransaction.findUniqueOrThrow({
				where: { id: mineTx.id },
			}),
		).resolves.toMatchObject({ categoryId: src.id, isLocked: true });
		await expect(
			fixtureDb.splitParticipant.findUniqueOrThrow({
				where: { id: myShare.id },
			}),
		).resolves.toMatchObject({ categoryId: src.id, categorySource: "PROJECT" });
		// Only what this mutation moved comes back.
		await expect(
			fixtureDb.sharedTransaction.findUniqueOrThrow({
				where: { id: bobsTx.id },
			}),
		).resolves.toMatchObject({ categoryId: null });
	});

	it("refuses a merge whose shares could not take the target, since a share's category is an expense category", async () => {
		const me = await arsUser();
		const gigs = await category(me, "Gigs", { kind: "INCOME" });
		const pay = await category(me, "Pay", { kind: "INCOME" });
		const tx = await sharedTx(me, null);
		const share = await shareOf(tx.id, me, gigs.id);
		await expect(run(me, gigs.id, pay.id)).rejects.toMatchObject({
			code: "INVALID",
		});
		await expect(
			fixtureDb.splitParticipant.findUniqueOrThrow({ where: { id: share.id } }),
		).resolves.toMatchObject({ categoryId: gigs.id });
	});

	it("a delete takes the pick's source off the share and the undo gives it back", async () => {
		const me = await arsUser();
		const src = await category(me, "Gifts");
		const tx = await sharedTx(me, src.id);
		const share = await shareOf(tx.id, me, src.id);
		const done = await run(me, src.id, null);
		await expect(
			fixtureDb.splitParticipant.findUniqueOrThrow({ where: { id: share.id } }),
		).resolves.toMatchObject({ categoryId: null, categorySource: null });
		await undo(me, done.value.stash);
		await expect(
			fixtureDb.splitParticipant.findUniqueOrThrow({ where: { id: share.id } }),
		).resolves.toMatchObject({ categoryId: src.id, categorySource: "USER" });
	});
});

describe("through categories.previewRemove, remove and restore", () => {
	const caller = (userId: string) =>
		createCallerFactory(categoriesRouter)({
			db: adminDb,
			session: {
				user: {
					id: userId,
					role: "USER",
					email: `${userId}@pg-test.invalid`,
					name: "Tester",
					isActive: true,
					protectionState: "OFF",
				},
			} as never,
			headers: new Headers(),
		});

	it("previews without writing, removes, and restores from the stash", async () => {
		const me = await arsUser();
		const from = await category(me, "Cafe");
		const into = await category(me, "Food");
		const row = await expense(me, from.id, 10);
		const api = caller(me);

		const preview = await api.previewRemove({ id: from.id, targetId: into.id });
		expect(preview.value.counts.expense.moved).toBe(1);
		await expect(
			fixtureDb.category.count({ where: { id: from.id } }),
		).resolves.toBe(1);

		const done = await api.remove({ id: from.id, targetId: into.id });
		await expect(
			fixtureDb.expense.findUniqueOrThrow({ where: { id: row.id } }),
		).resolves.toMatchObject({ categoryId: into.id });

		await api.restore({ stash: done.value.stash });
		await expect(
			fixtureDb.expense.findUniqueOrThrow({ where: { id: row.id } }),
		).resolves.toMatchObject({ categoryId: from.id });
	});

	it("words a refusal by its code", async () => {
		const me = await arsUser();
		const spending = await category(me, "Misc");
		const salary = await category(me, "Salary", { kind: "INCOME" });
		const api = caller(me);

		const refused = await api
			.remove({ id: salary.id, targetId: spending.id })
			.catch((e) => e as TRPCError);
		expect(problemCode(refused as TRPCError)).toBe("category_kind_mismatch");
	});
});

describe("an ARS budget book keeps its figures, valued at the rate each row was booked at", () => {
	// The book's starting balance needs a peso rate on the table; the rows
	// carry their own booked blue rate and never read it.
	beforeAll(async () => {
		const today = new Date(
			`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`,
		);
		for (const type of ["official", "blue"])
			await adminDb.exchangeRate.upsert({
				where: {
					date_currency_type: { date: today, currency: "ARS", type },
				},
				create: { date: today, currency: "ARS", type, rate: String(BLUE) },
				update: { rate: String(BLUE) },
			});
	});

	async function arsBook() {
		const s = await seedUser();
		await adminDb.user.update({
			where: { id: s.user.id },
			data: { homeCurrency: "ARS" },
		});
		await forUser(s.user.id).apply(setupEnvelopeBook, {
			...setupInput(s),
			timeZone: "UTC",
		});
		const book = await adminDb.budgetBook.findFirstOrThrow({
			where: { createdById: s.user.id },
			include: { envelopes: true },
		});
		const env = Object.fromEntries(book.envelopes.map((e) => [e.name, e.id]));
		const cafe = await category(s.user.id, "Cafe");
		await adminDb.envelopeCategory.create({
			data: {
				bookId: book.id,
				envelopeId: env.Dining as string,
				categoryId: cafe.id,
			},
		});
		// USD 10 and USD 4 booked at blue 1,545: ARS 15,450 and 6,180.
		await expense(s.user.id, cafe.id, 10);
		await expense(s.user.id, cafe.id, 4);
		return { ...s, cafe, env: env as Record<string, string> };
	}

	const spentIn = async (userId: string, envelopeId: string) =>
		(await getMonth(userId))?.groups
			.flatMap((g) => g.envelopes)
			.find((e) => e.id === envelopeId)?.spent;

	it("a merge inside one envelope changes nothing; into another envelope it moves exactly ARS 21,630", async () => {
		const b = await arsBook();
		// (10 + 4) x 1,545 = 21,630 pesos = 2,163,000 minor, not USD 14.
		const arsSpent = { minor: 2_163_000, currency: "ARS" };
		expect(await spentIn(b.user.id, b.env.Dining as string)).toEqual(arsSpent);

		const same = await category(b.user.id, "Dining too");
		await adminDb.envelopeCategory.create({
			data: {
				bookId: (
					await adminDb.budgetBook.findFirstOrThrow({
						where: { createdById: b.user.id },
					})
				).id,
				envelopeId: b.env.Dining as string,
				categoryId: same.id,
			},
		});
		await run(b.user.id, b.cafe.id, same.id);
		expect(await spentIn(b.user.id, b.env.Dining as string)).toEqual(arsSpent);

		await run(b.user.id, same.id, b.rent);
		expect(await spentIn(b.user.id, b.env.Rent as string)).toEqual(arsSpent);
		expect((await spentIn(b.user.id, b.env.Dining as string))?.minor).toBe(0);
	});
});
