/**
 * Bulk categorize and bulk delete on the device and on the server, one ledger
 * through both: the domain core (expense-write/bulk.ts) over the store and over
 * Prisma on a real Postgres. Each case seeds the same ARS-home rows (USD 10,
 * 20 and 30.01 at blue 1545, an income row, a transfer's fee, a spread part, a
 * spread parent), runs the action on both, and asserts the rows left, the ids
 * and reasons skipped, the counts and the undo agree, against values derived by
 * hand below. A refusal says the same words on both.
 *
 * Rates are global, and a case needs exactly its seed, so each case replaces
 * the table; the rows other files left in this worker's database are put back
 * after.
 */
import { randomUUID } from "node:crypto";
import {
	type BulkSkip,
	type CategoryMove,
	NOTHING_TO_DELETE,
} from "@retrospend/domain/expense-write/bulk";
import { CATEGORY_NOT_FOUND } from "@retrospend/domain/expense-write/refusals";
import { dec } from "@retrospend/domain/precise-decimal";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	deleteExpensesBulk,
	restoreExpensesBulk,
} from "~/server/services/entry/bulk-delete.mutation";
import { categorizeExpenses } from "~/server/services/entry/categorize.mutation";
import { createExpense } from "~/server/services/expense-create.mutation";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import type { Prisma } from "~prisma";
// The root app does not depend on the engine package; its cases are plain data and code.
import { cursor } from "../../../../packages/engine/src/device/fake-api";
import {
	categorizeExpenses as deviceCategorize,
	deleteExpenses as deviceDelete,
	EXPENSE_CATEGORIZE_MUTATION,
	EXPENSE_DELETE_MANY_MUTATION,
} from "../../../../packages/engine/src/expense-bulk-local";
import {
	createExpense as deviceCreate,
	EXPENSE_CREATE,
} from "../../../../packages/engine/src/expense-create";
import { editVectors } from "../../../../packages/engine/src/expense-edit-vectors";
import { LocalDb } from "../../../../packages/engine/src/local-db";
import { seededStore } from "../../../../packages/engine/src/local-expense-create";

const first = editVectors[0] as (typeof editVectors)[number];
const CAUGHT_UP = { expenses: cursor("200"), transfers: cursor("200") };

let others: Prisma.ExchangeRateCreateManyInput[] = [];
beforeAll(async () => {
	others = await adminDb.exchangeRate.findMany();
});
afterAll(async () => {
	await adminDb.exchangeRate.deleteMany({});
	await adminDb.exchangeRate.createMany({ data: others });
});

type Kind = "income" | "fee" | "part" | "parent";

/** What a row is, whichever side stored it. */
interface Seen {
	categoryId: string | null;
	excluded: boolean;
	homeAmount: string;
}

interface Done {
	updated: number;
	deleted: string[];
	skipped: BulkSkip[];
	undo(): Promise<void>;
}

interface Side {
	reset(): Promise<void>;
	create(id: string, amount: string): Promise<void>;
	category(id: string, kind: string, excludeByDefault: boolean): Promise<void>;
	plant(id: string, kind: Kind): Promise<void>;
	categorize(moves: CategoryMove[]): Promise<Done>;
	remove(ids: string[]): Promise<Done>;
	rows(): Promise<Record<string, Seen>>;
}

function deviceSide(): Side {
	let store: Awaited<ReturnType<typeof seededStore>>;
	let db: LocalDb;
	return {
		async reset() {
			store = await seededStore(first.seed);
			db = new LocalDb(store);
		},
		async create(id, amount) {
			await db.write(
				EXPENSE_CREATE,
				deviceCreate({ ...first.base, id, amount }),
			);
		},
		async category(id, kind, excludeByDefault) {
			await store.transaction((tx) =>
				tx.put("categories", {
					id,
					kind,
					name: id,
					color: "teal",
					icon: null,
					excludeByDefault,
				}),
			);
		},
		async plant(id, kind) {
			await store.transaction((tx) => {
				const row = tx.get("expenses", id);
				if (!row) throw new Error(`no expense ${id}`);
				if (kind === "income") tx.put("expenses", { ...row, direction: "IN" });
				else if (kind === "part")
					tx.put("expenses", { ...row, isAmortizedChild: true });
				else if (kind === "parent")
					tx.put("expenses", { ...row, isAmortizedParent: true });
				else
					tx.put("transfers", {
						id: `t-${id}`,
						date: row.date,
						toAccountId: null,
						toAmount: "0",
						toCurrency: row.currency,
						feeExpenseId: id,
					});
			});
		},
		async categorize(moves) {
			const { value, undo } = await db.write(
				EXPENSE_CATEGORIZE_MUTATION.id,
				deviceCategorize({ moves, cursors: CAUGHT_UP }),
			);
			return {
				updated: value.updated,
				deleted: [],
				skipped: value.skipped,
				undo: async () => void (await db.undo(undo)),
			};
		},
		async remove(ids) {
			const { value, undo } = await db.write(
				EXPENSE_DELETE_MANY_MUTATION.id,
				deviceDelete({ ids, cursors: CAUGHT_UP }),
			);
			return {
				updated: 0,
				deleted: value.deleted,
				skipped: value.skipped,
				undo: async () => void (await db.undo(undo)),
			};
		},
		async rows() {
			return Object.fromEntries(
				store.list("expenses").map((r) => [
					r.id,
					{
						categoryId: r.categoryId ?? null,
						excluded: r.excludeFromAnalytics,
						homeAmount: dec(String(r.homeAmount)).toFixed(2),
					},
				]),
			);
		},
	};
}

function serverSide(): Side {
	let userId = "";
	// Ids are global: each reset gets its own prefix.
	let prefix = "";
	const mine = (id: string) => prefix + id;
	const plain = (id: string | null) => id?.slice(prefix.length) ?? null;
	const reasons = (list: readonly BulkSkip[]) =>
		list.map((s) => ({ ...s, id: plain(s.id) as string }));
	return {
		async reset() {
			const { user } = await createTestUser();
			userId = user.id;
			prefix = `${randomUUID()}-`;
			await adminDb.user.update({
				where: { id: userId },
				data: {
					homeCurrency: first.seed.homeCurrency,
					timeZone: first.seed.timeZone,
					defaultRateTypes: first.seed.defaultRateTypes ?? {},
				},
			});
			await adminDb.exchangeRate.deleteMany({});
			await adminDb.exchangeRate.createMany({
				data: first.seed.rates.map((r) => ({
					currency: r.currency,
					type: r.type,
					rate: r.rate,
					date: r.date,
				})),
			});
		},
		async create(id, amount) {
			await forUser(userId).apply(createExpense, {
				...first.base,
				id: mine(id),
				amount,
			});
		},
		async category(id, kind, excludeByDefault) {
			await fixtureDb.category.create({
				data: {
					id: mine(id),
					userId,
					name: `Cat ${id}`,
					color: "teal",
					kind: kind as "EXPENSE" | "INCOME",
					excludeByDefault,
				},
			});
		},
		async plant(id, kind) {
			const where = { id: mine(id) };
			if (kind === "income")
				await fixtureDb.expense.update({
					where,
					data: { direction: "IN", inType: "INCOME" },
				});
			else if (kind === "part")
				await fixtureDb.expense.update({
					where,
					data: { isAmortizedChild: true },
				});
			else if (kind === "parent")
				await fixtureDb.expense.update({
					where,
					data: { isAmortizedParent: true },
				});
			else {
				const row = await fixtureDb.expense.findUniqueOrThrow({ where });
				const transfer = await fixtureDb.transfer.create({
					data: {
						userId,
						kind: "TRANSFER",
						date: row.date,
						fromAmount: "100",
						fromCurrency: row.currency,
						toAmount: "100",
						toCurrency: row.currency,
						feeExpenseId: row.id,
					},
				});
				await fixtureDb.accountLeg.create({
					data: {
						userId,
						transferId: transfer.id,
						expenseId: row.id,
						currency: row.currency,
						amount: "-100",
						date: row.date,
						source: "FEE",
					},
				});
			}
		},
		async categorize(moves) {
			const input = {
				moves: moves.map((m) => ({
					...m,
					categoryId: m.categoryId && mine(m.categoryId),
					ids: m.ids.map(mine),
				})),
			};
			const { value } = await forUser(userId).apply(categorizeExpenses, input);
			return {
				updated: value.updated,
				deleted: [],
				skipped: reasons(value.skipped),
				// The v1 undo: the same mutation over `previous`, lenient, with the stamps.
				undo: async () => {
					await forUser(userId).apply(categorizeExpenses, {
						moves: value.previous,
						lenient: true,
						expected: value.stamps,
					});
				},
			};
		},
		async remove(ids) {
			const { value } = await forUser(userId).apply(deleteExpensesBulk, {
				ids: ids.map(mine),
			});
			return {
				updated: 0,
				deleted: value.ids.map((id) => plain(id) as string),
				// The server answers skipped ids only; the reasons are the domain's.
				skipped: value.skipped.map((id) => ({
					id: plain(id) as string,
					reason: "notFound" as const,
				})),
				undo: async () => {
					await forUser(userId).apply(restoreExpensesBulk, {
						stash: value.stash,
					});
				},
			};
		},
		async rows() {
			const rows = await fixtureDb.expense.findMany({
				where: { userId, id: { startsWith: prefix } },
			});
			return Object.fromEntries(
				rows.map((r) => [
					plain(r.id) as string,
					{
						categoryId: plain(r.categoryId),
						excluded: r.excludeFromAnalytics,
						homeAmount: dec(String(r.homeAmount)).toFixed(2),
					},
				]),
			);
		},
	};
}

/** The same ledger on one side: a, b, c, then an income row, a fee, a spread part and parent. */
async function ledger(side: Side) {
	await side.reset();
	for (const [id, amount] of [
		["a", "10"],
		["b", "20"],
		["c", "30.01"],
		["d", "1"],
		["e", "1"],
		["f", "1"],
		["g", "1"],
	] as const)
		await side.create(id, amount);
	await side.category("food", "EXPENSE", false);
	await side.category("hold", "EXPENSE", true);
	await side.category("pay", "INCOME", false);
	await side.plant("d", "income");
	await side.plant("e", "fee");
	await side.plant("f", "part");
	await side.plant("g", "parent");
	return side;
}

const sides = [
	["device", deviceSide],
	["server", serverSide],
] as const;

const refusal = async (run: () => Promise<unknown>) =>
	((await run().catch((e) => e)) as Error).message;

describe.each(sides)("bulk delete on the %s", (_name, make) => {
	it("takes USD 10, 20 and 30.01 at blue 1545 (ARS 92,715.45), skips the rest in order, and one undo brings the three back", async () => {
		const side = await ledger(make());
		const before = await side.rows();
		// 10 x 1545 = 15,450.00; 20 x 1545 = 30,900.00; 30.01 x 1545 = 46,350 + 15.45 = 46,365.45.
		expect(
			["a", "b", "c"].map((id) => (before[id] as Seen).homeAmount),
		).toEqual(["15450.00", "30900.00", "46365.45"]);
		const done = await side.remove([
			"c",
			"e",
			"a",
			"ghost",
			"d",
			"b",
			"f",
			"a",
		]);
		expect(done.deleted).toEqual(["c", "a", "b"]);
		expect(done.skipped.map((s) => s.id)).toEqual(["e", "ghost", "d", "f"]);
		expect(Object.keys(await side.rows()).sort()).toEqual(["d", "e", "f", "g"]);
		await done.undo();
		expect(await side.rows()).toEqual(before);
	});

	it("refuses when nothing can go, in the same words", async () => {
		const side = await ledger(make());
		const before = await side.rows();
		expect(await refusal(() => side.remove(["d", "e", "f", "ghost"]))).toBe(
			NOTHING_TO_DELETE,
		);
		expect(await side.rows()).toEqual(before);
	});
});

describe.each(sides)("bulk categorize on the %s", (_name, make) => {
	it("moves the three rows into a category held out by default, flags them, skips the rest with a reason, and one undo puts category and flag back", async () => {
		const side = await ledger(make());
		const before = await side.rows();
		const done = await side.categorize([
			{ categoryId: "hold", ids: ["a", "d", "b", "e", "f", "g", "c", "ghost"] },
		]);
		expect(done.updated).toBe(3);
		expect(done.skipped).toEqual([
			{ id: "d", reason: "notFound" },
			{ id: "e", reason: "hasLegs" },
			{ id: "f", reason: "notFound" },
			{ id: "g", reason: "spread" },
			{ id: "ghost", reason: "notFound" },
		]);
		const after = await side.rows();
		for (const id of ["a", "b", "c"])
			expect(after[id], id).toMatchObject({
				categoryId: "hold",
				excluded: true,
			});
		for (const id of ["d", "e", "f", "g"])
			expect(after[id], id).toEqual(before[id]);
		await done.undo();
		expect(await side.rows()).toEqual(before);
	});

	it("an income or unknown category is Category not found, whatever the ids, and nothing moves", async () => {
		const side = await ledger(make());
		const before = await side.rows();
		for (const categoryId of ["pay", "missing"])
			expect(
				await refusal(() =>
					side.categorize([{ categoryId, ids: ["a", "ghost"] }]),
				),
			).toBe(CATEGORY_NOT_FOUND);
		expect(await side.rows()).toEqual(before);
	});
});
