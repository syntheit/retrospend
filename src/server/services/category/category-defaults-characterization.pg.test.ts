/**
 * M3 PR0: what a category's excludeByDefault flag does, and the paths that
 * create categories without a person naming them, as they behave today.
 * ARS home, USD 100 at Blue 1,468 books ARS 146,800 (seedArsRates).
 *
 * Already pinned elsewhere, not repeated here: an expense create and an edit
 * that changes the category on all three transports (entry/__tests__/
 * expense-write-patch.pg.test.ts), the posted recurring row that ignores the
 * flag (recurring-write-characterization.pg.test.ts), the sign-up seed's key
 * and index (category-seed.pg.test.ts).
 *
 * Hand-derived:
 *   - A bulk move has a three-way flag: an explicit `excluded` wins; else a
 *     target with excludeByDefault true sets true; else each row keeps its own.
 *   - A category toggle changes the category row only: rows already booked keep
 *     their flag, and its Undo is a second PATCH that sets the old value.
 *   - The sign-up seed writes 24 EXPENSE categories (DEFAULT_CATEGORIES) once;
 *     the income names are 6 (Salary, Freelance, Gifts, Interest, Sales, Other
 *     income) and are written on the first catalog read.
 *   - Seeds and ensureIncomeCategories compare names untrimmed in SQL (the
 *     plain suite, no index) and by trimmed-name index when sealing: "Salary "
 *     and "Salary" are two names in the first, one in the second.
 *   - An import row takes the file's own flag first, then the category's
 *     default, else false.
 */
import { randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_CATEGORIES } from "~/lib/constants";
import { call, expectBody } from "~/server/api/v1/core/__tests__/harness";
import {
	arsUser,
	seedArsRates,
} from "~/server/services/accounts/test-fixtures";
import {
	book,
	lunch,
	makeWorld,
	stored,
	type World,
} from "~/server/services/entry/__tests__/expense-write-kit";
import { forUser } from "~/server/services/preview";
import { createTestUser, fixtureDb, sealedSuite } from "~/test/pg-harness";
import type { Prisma } from "~prisma";
import { seedDefaultCategories } from "../category.service";
import {
	type CommitImportInput,
	commitImport,
} from "../import/commit.mutation";
import { ensureIncomeCategories, INCOME_CATEGORIES } from "../money-in.service";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

beforeAll(seedArsRates);

const c = contract.categories;
const rowsOf = (userId: string) =>
	fixtureDb.category.findMany({ where: { userId } });
const flag = async (id: string) => (await stored(id))?.excludeFromAnalytics;

describe("the sign-up seed", () => {
	it("writes the 24 default categories as plain expense categories, once", async () => {
		const user = await createTestUser();
		expect(await seedDefaultCategories(user.db, user.user.id)).toBe(24);
		const rows = await rowsOf(user.user.id);
		const pairs = (list: readonly { name: string; color: string }[]) =>
			list.map((r) => `${r.name}:${r.color}`).sort();
		expect(pairs(rows)).toEqual(pairs(DEFAULT_CATEGORIES));
		expect(rows).toHaveLength(24);
		for (const row of rows)
			expect(row).toMatchObject({
				kind: "EXPENSE",
				isFixed: false,
				excludeByDefault: false,
				icon: null,
			});
		expect(await seedDefaultCategories(user.db, user.user.id)).toBe(0);
		expect(await rowsOf(user.user.id)).toHaveLength(24);
	});

	it("a later seed (the sync script) brings back a renamed or deleted default, and leaves the rest", async () => {
		const user = await createTestUser();
		await seedDefaultCategories(user.db, user.user.id);
		const rows = await rowsOf(user.user.id);
		const idOf = (name: string) =>
			(rows.find((r) => r.name === name) as { id: string }).id;
		// Renamed away: the default name is free again, so it is added again.
		await fixtureDb.category.update({
			where: { id: idOf("Groceries") },
			data: { name: "Food shopping" },
		});
		await fixtureDb.category.delete({ where: { id: idOf("Gym") } });
		expect(await seedDefaultCategories(user.db, user.user.id)).toBe(2);
		const after = (await rowsOf(user.user.id)).map((r) => r.name);
		expect(after).toHaveLength(25);
		expect(after).toContain("Food shopping");
		expect(after).toContain("Groceries");
		expect(after).toContain("Gym");
	});

	it("a default that differs by case is added, one that differs by an edge space only when no name index compares it", async () => {
		const user = await createTestUser();
		await fixtureDb.category.createMany({
			data: [
				{ userId: user.user.id, name: "cafe", color: "blue" },
				{ userId: user.user.id, name: "Rent ", color: "blue" },
			],
		});
		const added = await seedDefaultCategories(user.db, user.user.id);
		// 24 defaults; "cafe" is not "Cafe" so nothing is skipped for it. "Rent "
		// is the same trimmed name as "Rent" to the index (sealed suite: skipped),
		// and another name to the SQL unique key (plain suite: added).
		expect(added).toBe(sealedSuite ? 23 : 24);
	});
});

describe("ensureIncomeCategories inserts on reads", () => {
	let w: World;
	beforeAll(async () => {
		w = await makeWorld();
	});

	it("a fresh user has no income category until the catalog is read, then six, then no more", async () => {
		const user = await createTestUser();
		expect(
			await fixtureDb.category.count({
				where: { userId: user.user.id, kind: "INCOME" },
			}),
		).toBe(0);
		const income = await ensureIncomeCategories(user.db, user.user.id);
		expect(income.map((r) => [r.name, r.color]).sort()).toEqual(
			INCOME_CATEGORIES.map((i) => [i.name, i.color]).sort(),
		);
		expect(INCOME_CATEGORIES.map((i) => [i.name, i.color]).sort()).toEqual([
			["Freelance", "teal"],
			["Gifts", "pink"],
			["Interest", "cyan"],
			["Other income", "lime"],
			["Salary", "emerald"],
			["Sales", "amber"],
		]);
		for (const row of income)
			expect(row).toMatchObject({ kind: "INCOME", excludeByDefault: false });
		await ensureIncomeCategories(user.db, user.user.id);
		expect(await rowsOf(user.user.id)).toHaveLength(6);
	});

	it("the web's entry catalog read writes them, and a second read writes nothing", async () => {
		const before = await fixtureDb.category.count({
			where: { userId: w.userId, kind: "INCOME" },
		});
		// makeWorld made one INCOME category by hand, with a random name.
		expect(before).toBe(1);
		await w.callers.entry.catalog();
		expect(
			await fixtureDb.category.count({
				where: { userId: w.userId, kind: "INCOME" },
			}),
		).toBe(1 + INCOME_CATEGORIES.length);
		await w.callers.entry.catalog();
		expect(
			await fixtureDb.category.count({
				where: { userId: w.userId, kind: "INCOME" },
			}),
		).toBe(1 + INCOME_CATEGORIES.length);
	});

	it("compares its names untrimmed in JS: 'Salary ' does not stop 'Salary', and 'salary' does not either", async () => {
		const user = await createTestUser();
		await fixtureDb.category.createMany({
			data: [
				{ userId: user.user.id, name: "Salary ", color: "blue" },
				{ userId: user.user.id, name: "salary", color: "blue" },
			],
		});
		const income = await ensureIncomeCategories(user.db, user.user.id);
		const names = income.map((r) => r.name).sort();
		// "salary" is another name in both suites, so the five others come, and
		// "Salary" comes unless the name index (sealed suite) calls it taken by
		// "Salary " and the insert is skipped.
		const others = INCOME_CATEGORIES.map((i) => i.name)
			.filter((n) => n !== "Salary")
			.sort();
		expect(names).toEqual(sealedSuite ? others : [...others, "Salary"].sort());
		const all = (await rowsOf(user.user.id)).map((r) => r.name).sort();
		expect(all).toHaveLength(2 + names.length);
	});
});

describe("the phone's count toggle", () => {
	let w: World;
	beforeAll(async () => {
		w = await makeWorld();
	});

	const patch = (id: string, body: unknown) =>
		call(`/categories/${id}`, {
			method: "PATCH",
			headers: w.http,
			body,
			idempotent: true,
		});

	it("changes the category row only; booked rows keep their flag, later rows follow it, and Undo is a second PATCH", async () => {
		const made = await expectBody<{ id: string; excludeByDefault: boolean }>(
			await call("/categories", {
				method: "POST",
				headers: w.http,
				body: { name: "Toggled", color: "teal" },
				idempotent: true,
			}),
			c.create,
			201,
		);
		const early = await book(w.userId, lunch(w, { categoryId: made.id }));
		expect(await flag(early)).toBe(false);

		const off = await expectBody<{ excludeByDefault: boolean }>(
			await patch(made.id, { excludeByDefault: true }),
			c.update,
		);
		expect(off.excludeByDefault).toBe(true);
		expect(await flag(early)).toBe(false);
		const during = randomUUID();
		expect(
			await w.v1.create(during, lunch(w, { categoryId: made.id })),
		).toEqual({ ok: true });
		expect(await stored(during)).toMatchObject({
			excludeFromAnalytics: true,
			homeAmount: expect.anything(),
		});
		expect((await stored(during))?.homeAmount?.toString()).toBe("146800");

		// The toast's Undo re-sends the old value; it does not touch the rows.
		const undone = await expectBody<{ excludeByDefault: boolean }>(
			await patch(made.id, { excludeByDefault: false }),
			c.update,
		);
		expect(undone.excludeByDefault).toBe(false);
		expect(await flag(during)).toBe(true);
		const after = randomUUID();
		await w.v1.create(after, lunch(w, { categoryId: made.id }));
		expect(await flag(after)).toBe(false);
	});

	it("an Undo after another device's toggle overwrites it: no expectedVersion is sent yet, so no refusal", async () => {
		const mine = await expectBody<{ id: string }>(
			await call("/categories", {
				method: "POST",
				headers: w.http,
				body: { name: "Two devices", color: "blue" },
				idempotent: true,
			}),
			c.create,
			201,
		);
		await patch(mine.id, { excludeByDefault: true }); // device A
		await patch(mine.id, { excludeByDefault: false }); // device B
		await patch(mine.id, { excludeByDefault: false }); // A's Undo, re-sending its old value
		expect(
			(await fixtureDb.category.findUniqueOrThrow({ where: { id: mine.id } }))
				.excludeByDefault,
		).toBe(false);
	});

	it("an expense edited into the toggled category takes the default, one left in it does not", async () => {
		const made = await fixtureDb.category.create({
			data: { userId: w.userId, name: "Later toggled", color: "pink" },
		});
		const moving = await book(w.userId, lunch(w));
		const staying = await book(w.userId, lunch(w, { categoryId: made.id }));
		await patch(made.id, { excludeByDefault: true });
		expect(
			await w.v1.update(moving, lunch(w, { categoryId: made.id })),
		).toEqual({ ok: true });
		expect(await flag(moving)).toBe(true);
		expect(
			await w.v1.update(
				staying,
				lunch(w, { categoryId: made.id, title: "Same" }),
			),
		).toEqual({ ok: true });
		expect(await flag(staying)).toBe(false);
	});
});

describe("a bulk move: the flag is three-way", () => {
	let w: World;
	let plain: string;
	beforeAll(async () => {
		w = await makeWorld();
		plain = (
			await fixtureDb.category.create({
				data: { userId: w.userId, name: "Plain target", color: "blue" },
			})
		).id;
	});

	const rows = async () => ({
		counted: await book(w.userId, lunch(w, { excludeFromAnalytics: false })),
		held: await book(w.userId, lunch(w, { excludeFromAnalytics: true })),
	});
	const flags = async (r: { counted: string; held: string }) => [
		await flag(r.counted),
		await flag(r.held),
	];
	const moveV1 = (ids: string[], categoryId: string) =>
		call("/expenses/bulk-category", {
			method: "POST",
			headers: w.http,
			body: { ids, categoryId },
			idempotent: true,
		});

	it("into a plain category each row keeps its own flag, tRPC and v1", async () => {
		const r = await rows();
		await w.callers.entry.expense.categorize.save({
			moves: [{ categoryId: plain, ids: [r.counted, r.held] }],
		});
		expect(await flags(r)).toEqual([false, true]);
		const v = await rows();
		expect((await moveV1([v.counted, v.held], plain)).status).toBe(200);
		expect(await flags(v)).toEqual([false, true]);
	});

	it("into a category that holds out by default every moved row is excluded, and moving out again does not reset it", async () => {
		const r = await rows();
		await w.callers.entry.expense.categorize.save({
			moves: [{ categoryId: w.holdByDefault, ids: [r.counted, r.held] }],
		});
		expect(await flags(r)).toEqual([true, true]);
		await w.callers.entry.expense.categorize.save({
			moves: [{ categoryId: plain, ids: [r.counted, r.held] }],
		});
		expect(await flags(r)).toEqual([true, true]);
		const v = await rows();
		expect((await moveV1([v.counted, v.held], w.holdByDefault)).status).toBe(
			200,
		);
		expect(await flags(v)).toEqual([true, true]);
	});

	it("an explicit flag on the move wins over the target's default (tRPC only: v1 sends none)", async () => {
		const r = await rows();
		await w.callers.entry.expense.categorize.save({
			moves: [
				{
					categoryId: w.holdByDefault,
					ids: [r.counted, r.held],
					excluded: false,
				},
			],
		});
		expect(await flags(r)).toEqual([false, false]);
	});
});

describe("import", () => {
	const row = (title: string, amount: number, extra: object = {}) => ({
		title,
		amount,
		currency: "ARS",
		date: new Date().toISOString().slice(0, 10),
		location: "",
		description: "",
		pricingSource: "IMPORT",
		category: "",
		...extra,
	});

	it("takes the file's flag first, then the category's default, else counted", async () => {
		const user = await arsUser();
		const hold = await fixtureDb.category.create({
			data: {
				userId: user.user.id,
				name: "Holds",
				color: "teal",
				excludeByDefault: true,
			},
		});
		const plain = await fixtureDb.category.create({
			data: { userId: user.user.id, name: "Plain", color: "blue" },
		});
		const file = [
			row("A no flag in a default category", 100),
			row("B file says counted", 200, { excludeFromAnalytics: false }),
			row("C plain category", 300),
			row("D file says excluded", 400, { excludeFromAnalytics: true }),
			row("E no category", 500),
		];
		const job = await fixtureDb.importJob.create({
			data: {
				userId: user.user.id,
				status: "READY_FOR_REVIEW",
				type: "CSV",
				fileName: "defaults.csv",
				fileSize: 100,
				fileType: "csv",
				transactions: file as unknown as Prisma.InputJsonValue,
				warnings: [],
				totalTransactions: file.length,
			},
		});
		const rows: CommitImportInput["rows"] = [
			{ index: 0, keep: true, categoryId: hold.id, kind: "expense" },
			{ index: 1, keep: true, categoryId: hold.id, kind: "expense" },
			{ index: 2, keep: true, categoryId: plain.id, kind: "expense" },
			{ index: 3, keep: true, categoryId: plain.id, kind: "expense" },
			{ index: 4, keep: true, categoryId: null, kind: "expense" },
		];
		await forUser(user.user.id).apply(commitImport, { jobId: job.id, rows });
		const made = await fixtureDb.expense.findMany({
			where: { userId: user.user.id },
		});
		const flagOf = (title: string) =>
			made.find((m) => m.title === title)?.excludeFromAnalytics;
		expect(made).toHaveLength(5);
		expect(flagOf("A no flag in a default category")).toBe(true);
		expect(flagOf("B file says counted")).toBe(false);
		expect(flagOf("C plain category")).toBe(false);
		expect(flagOf("D file says excluded")).toBe(true);
		expect(flagOf("E no category")).toBe(false);
		// ARS in an ARS home books at rate 1: ARS 100 is ARS 100.
		expect(
			made.find((m) => m.title.startsWith("A "))?.homeAmount?.toString(),
		).toBe("100");
	});
});
