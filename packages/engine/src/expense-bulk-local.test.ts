import { NOTHING_TO_DELETE } from "@retrospend/domain/expense-write/bulk";
import {
	CATEGORY_NOT_FOUND,
	SPREAD_NOT_ON_DEVICE,
} from "@retrospend/domain/expense-write/refusals";
import { describe, expect, it } from "vitest";
import { cursor } from "./device/fake-api";
import {
	categorizeExpenses,
	deleteExpenses,
	EXPENSE_CATEGORIZE,
	EXPENSE_CATEGORIZE_MUTATION,
	EXPENSE_DELETE_MANY,
	EXPENSE_DELETE_MANY_MUTATION,
} from "./expense-bulk-local";
import {
	type CreateExpenseInput,
	createExpense,
	EXPENSE_CREATE,
} from "./expense-create";
import { editVectors } from "./expense-edit-vectors";
import { SYNC_FIRST } from "./expense-write-local";
import type { ExpenseRow } from "./expenses";
import { InvalidInputError, LocalDb, TABLE_NAMES } from "./index";
import { seededStore } from "./local-expense-create";
import { createDevicePreviewRunner } from "./preview";
import { deviceFigures } from "./registry";

// ARS home, blue 1545 on 2026-03-05.
const first = editVectors[0] as (typeof editVectors)[number];
const CAUGHT_UP = { expenses: cursor("200"), transfers: cursor("200") };

const usd = (id: string, amount: string): CreateExpenseInput => ({
	...first.base,
	id,
	amount,
});

const category = (id: string, kind: string, excludeByDefault = false) => ({
	id,
	kind,
	name: id,
	color: "teal",
	icon: null,
	excludeByDefault,
});

const dump = (store: Awaited<ReturnType<typeof seededStore>>) =>
	Object.fromEntries(TABLE_NAMES.map((t) => [t, store.list(t)]));

/** USD 10, 20 and 30.01 (ids a, b, c) booked at blue 1545, and three categories. */
async function open() {
	const store = await seededStore(first.seed);
	const db = new LocalDb(store);
	for (const [id, amount] of [
		["a", "10"],
		["b", "20"],
		["c", "30.01"],
	] as const)
		await db.write(EXPENSE_CREATE, createExpense(usd(id, amount)));
	await store.transaction((tx) => {
		tx.put("categories", category("food", "EXPENSE"));
		tx.put("categories", category("hold", "EXPENSE", true));
		tx.put("categories", category("pay", "INCOME"));
	});
	const put = (fn: Parameters<typeof store.transaction>[0]) =>
		store.transaction(fn);
	const row = (id: string) => store.get("expenses", id) as ExpenseRow;
	return { store, db, put, row };
}

const remove = (db: LocalDb, ids: string[], cursors = CAUGHT_UP) =>
	db.write(EXPENSE_DELETE_MANY, deleteExpenses({ ids, cursors }));
const move = (
	db: LocalDb,
	categoryId: string | null,
	ids: string[],
	over: { lenient?: boolean; cursors?: typeof CAUGHT_UP } = {},
) =>
	db.write(
		EXPENSE_CATEGORIZE,
		categorizeExpenses({
			moves: [{ categoryId, ids }],
			cursors: CAUGHT_UP,
			...over,
		}),
	);

async function refuses(
	run: () => Promise<unknown>,
	store: Awaited<ReturnType<typeof seededStore>>,
	message: string,
) {
	const before = dump(store);
	const error = await run().catch((e) => e);
	expect(error).toBeInstanceOf(InvalidInputError);
	expect((error as Error).message).toBe(message);
	expect(dump(store)).toEqual(before);
}

describe("bulk delete on the device", () => {
	it("USD 10, 20 and 30.01 at blue 1545 take ARS 92,715.45 out of spent, and one undo brings all three back", async () => {
		const { store } = await open();
		const before = dump(store);
		const runner = createDevicePreviewRunner({
			store,
			figures: deviceFigures({ clock: () => first.base.date }),
			actor: { userId: "u1" },
		});
		const input = { ids: ["a", "b", "c"], cursors: CAUGHT_UP };
		const preview = await runner.preview(EXPENSE_DELETE_MANY_MUTATION, input);
		expect(dump(store)).toEqual(before);
		// 10 + 20 + 30.01 = USD 60.01. At 1545: 15,450.00 + 30,900.00 + 46,365.45
		// (30.01 x 1545 = 46,350 + 15.45) = 92,715.45.
		expect(preview.changes).toEqual([
			expect.objectContaining({
				id: "spent",
				delta: { minor: -6_001, currency: "USD" },
			}),
			expect.objectContaining({
				id: "glance.spent",
				delta: { minor: -9_271_545, currency: "ARS" },
			}),
		]);
		const { undo, ...applied } = await runner.apply(
			EXPENSE_DELETE_MANY_MUTATION,
			input,
		);
		expect(applied).toEqual(preview);
		expect(store.list("expenses")).toEqual([]);
		await new LocalDb(store).undo(undo);
		expect(dump(store)).toEqual(before);
	});

	it("skips what the server skips, with its reasons, and goes on with the rest", async () => {
		const { db, store, put, row } = await open();
		await put((tx) => {
			tx.put("expenses", { ...row("b"), direction: "IN" });
			tx.put("transfers", {
				id: "t1",
				date: first.base.date,
				toAccountId: null,
				toAmount: "0",
				toCurrency: "USD",
				feeExpenseId: "c",
			});
		});
		const { value } = await remove(db, ["c", "b", "ghost", "a"]);
		expect(value.deleted).toEqual(["a"]);
		expect(value.skipped).toEqual([
			{ id: "c", reason: "hasLegs" },
			{ id: "b", reason: "notFound" },
			{ id: "ghost", reason: "notFound" },
		]);
		expect(store.list("expenses").map((r) => r.id)).toEqual(["b", "c"]);
	});

	it("is refused when nothing can go, with the server's words", async () => {
		const { store, db } = await open();
		await refuses(() => remove(db, ["ghost"]), store, NOTHING_TO_DELETE);
	});

	it("a spread parent refuses the whole set and deletes nothing", async () => {
		const { store, db, put, row } = await open();
		await put((tx) =>
			tx.put("expenses", { ...row("b"), isAmortizedParent: true }),
		);
		await refuses(() => remove(db, ["a", "b"]), store, SPREAD_NOT_ON_DEVICE);
	});

	it("waits for the transfers pull before it can tell a fee", async () => {
		const { store, db } = await open();
		await refuses(
			() =>
				remove(db, ["a"], {
					expenses: cursor("200"),
					transfers: cursor("100"),
				}),
			store,
			SYNC_FIRST,
		);
	});
});

describe("bulk categorize on the device", () => {
	it("moves the rows it reaches into a category held out by default, which takes them out of spent, and one undo puts category and flag back", async () => {
		const { store, put, row } = await open();
		await put((tx) => {
			tx.put("expenses", {
				...row("a"),
				categoryId: "food",
				categoryKind: "EXPENSE",
			});
			tx.put("expenses", { ...row("c"), direction: "IN" });
		});
		const before = dump(store);
		const runner = createDevicePreviewRunner({
			store,
			figures: deviceFigures({ clock: () => first.base.date }),
			actor: { userId: "u1" },
		});
		const input = {
			moves: [{ categoryId: "hold", ids: ["a", "b", "c"] }],
			cursors: CAUGHT_UP,
		};
		const preview = await runner.preview(EXPENSE_CATEGORIZE_MUTATION, input);
		// a (USD 10) and b (USD 20) leave spent: USD 30.00, ARS 46,350.00 at 1545.
		// c is an income row and stays where it is.
		expect(preview.changes).toEqual([
			expect.objectContaining({
				id: "spent",
				delta: { minor: -3_000, currency: "USD" },
			}),
			expect.objectContaining({
				id: "glance.spent",
				delta: { minor: -4_635_000, currency: "ARS" },
			}),
		]);
		const { value, undo } = await runner.apply(
			EXPENSE_CATEGORIZE_MUTATION,
			input,
		);
		expect(value).toMatchObject({
			updated: 2,
			skipped: [{ id: "c", reason: "notFound" }],
		});
		expect(row("a")).toMatchObject({
			categoryId: "hold",
			categoryKind: "EXPENSE",
			excludeFromAnalytics: true,
		});
		expect(row("c").categoryId).toBeNull();
		await new LocalDb(store).undo(undo);
		expect(dump(store)).toEqual(before);
	});

	it("an income or unknown category is Category not found whatever the ids, and nothing moves", async () => {
		const { db, store } = await open();
		for (const id of ["pay", "missing"])
			await refuses(
				() => move(db, id, ["a", "ghost"]),
				store,
				CATEGORY_NOT_FOUND,
			);
	});

	it("an undo whose old category is gone or no longer an expense category puts the row back uncategorized, with its flag", async () => {
		for (const gone of ["deleted", "income"] as const) {
			const { db, put, row } = await open();
			await put((tx) =>
				tx.put("expenses", {
					...row("a"),
					categoryId: "food",
					categoryKind: "EXPENSE",
				}),
			);
			const { undo } = await move(db, "hold", ["a"]);
			expect(row("a").excludeFromAnalytics).toBe(true);
			await put((tx) =>
				gone === "deleted"
					? tx.delete("categories", "food")
					: tx.put("categories", category("food", "INCOME")),
			);
			await db.undo(undo);
			expect(row("a"), gone).toMatchObject({
				categoryId: null,
				categoryKind: null,
				excludeFromAnalytics: false,
			});
		}
	});

	it("an undo whose old category is still there puts it back", async () => {
		const { db, put, row } = await open();
		await put((tx) =>
			tx.put("expenses", {
				...row("a"),
				categoryId: "food",
				categoryKind: "EXPENSE",
			}),
		);
		const { undo } = await move(db, "hold", ["a"]);
		await db.undo(undo);
		expect(row("a")).toMatchObject({
			categoryId: "food",
			categoryKind: "EXPENSE",
			excludeFromAnalytics: false,
		});
	});

	it("lenient: a gone category leaves the rows uncategorized", async () => {
		const { db, row } = await open();
		await move(db, "food", ["a"]);
		await move(db, "missing", ["a"], { lenient: true });
		expect(row("a")).toMatchObject({
			categoryId: null,
			categoryKind: null,
		});
	});

	it("skips a transfer's fee and a spread parent or part, and counts the rest", async () => {
		const { db, put, row } = await open();
		await put((tx) => {
			tx.put("transfers", {
				id: "t1",
				date: first.base.date,
				toAccountId: null,
				toAmount: "0",
				toCurrency: "USD",
				feeExpenseId: "a",
			});
			tx.put("expenses", { ...row("b"), isAmortizedParent: true });
			tx.put("expenses", { ...row("c"), isAmortizedChild: true });
		});
		const { value } = await move(db, "food", ["a", "b", "c"]);
		expect(value.updated).toBe(0);
		expect(value.skipped).toEqual([
			{ id: "a", reason: "hasLegs" },
			{ id: "b", reason: "spread" },
			{ id: "c", reason: "notFound" },
		]);
		for (const id of ["a", "b", "c"]) expect(row(id).categoryId).toBeNull();
	});

	it("waits for the transfers pull", async () => {
		const { db, store } = await open();
		await refuses(
			() =>
				move(db, "food", ["a"], {
					cursors: { expenses: cursor("200"), transfers: cursor("100") },
				}),
			store,
			SYNC_FIRST,
		);
	});
});
