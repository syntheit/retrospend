/**
 * The device booking of a category write over the pending writes, and what
 * the writes that file into a category do about one that is still unsent.
 * Home ARS in Buenos Aires, blue 1,545; a pulled category "Food" (v2) and
 * "Bills" (v0), both counted by default.
 *
 * - A name is taken over the pulled categories AND the device's own unsent
 *   creates and renames, whose names the entry hands over in memory
 *   (`categoryNames`); a name the entry did not hand over cannot be seen.
 * - An expense, a template or a bulk move into a category the device made or
 *   edited and has not sent books (no unknown_category) and names the entries
 *   it waits for in `chainOn`; once the server has the entry (an ack) it waits
 *   for nothing, and a parked entry is not in the overlay at all.
 * - The create of a category cannot be taken back while a write the device
 *   holds names it, before or after the category was sent.
 * Expected values by hand: USD 20.00 at blue is ARS 30,900.00.
 */
import { IdTakenError } from "@retrospend/domain/id-taken";
import { CategoryChangedError } from "@retrospend/domain/category-version";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	CategoryNameTakenError,
	createCategory,
	updateCategory,
} from "../category-write-local";
import { fixtureRow } from "../fixtures";
import { ConflictError } from "../errors";
import { LocalDb } from "../local-db";
import { InvalidInputError } from "../port";
import {
	type BookedWrite,
	bookIn,
	isDeviceRefusal,
	type WriteBody,
} from "./book";
import { bookBulkIn } from "./bulk";
import {
	type CategoryCreateBody,
	chainOnCategory,
	entryRowsNamingCategory,
	refuseCategoryUncreate,
} from "./category-book";
import { createDeviceEngine, type DeviceEngine } from "./engine";
import { cursor, expense, fakeDeviceApi } from "./fake-api";
import { createExpense, EXPENSE_CREATE } from "../expense-create";
import { type PendingEntry, type PendingSource, readOverlaid } from "./pending";
import { seededCategoryStore } from "../category-conformance";
import { ARS, uuid } from "../category-vector-types";

const NOW = Date.parse("2026-11-10T15:00:00.000Z");
const [FOOD, BILLS, GIFTS] = [uuid(1), uuid(2), uuid(3)];
/** Expenses and transfers pulled as far as each other: the device may edit and bulk-move. */
const CAUGHT_UP = { expenses: cursor("200"), transfers: cursor("200") };

const open = () =>
	seededCategoryStore({
		seed: ARS,
		categories: [
			{ id: FOOD, name: "Food", color: "teal", kind: "EXPENSE", version: 2 },
			{ id: BILLS, name: "Bills", color: "blue", kind: "EXPENSE" },
		],
	});

const makeGifts = (over: Partial<CategoryCreateBody> = {}) =>
	({
		kind: "categoryCreate",
		body: { id: GIFTS, name: "Gifts", color: "pink", ...over },
	}) as const;

const lunch = (over: Partial<WriteBody> = {}): WriteBody => ({
	id: uuid(10),
	title: "Gift",
	amount: "20",
	currency: "USD",
	date: "2026-11-10",
	categoryId: GIFTS,
	...over,
});

/** An expense of USD 20.00 in the store, as the pull would have left it, in `categoryId` when given. */
async function expenseIn(
	store: Awaited<ReturnType<typeof open>>,
	id: string,
	category?: { id: string; kind: string; excludeByDefault: boolean },
) {
	await new LocalDb(store).write(
		EXPENSE_CREATE,
		createExpense({
			id,
			title: "t",
			amount: "20",
			currency: "USD",
			date: new Date("2026-11-10T15:00:00.000Z"),
			...(category ? { category } : {}),
		}),
	);
}

/** The entry the phone's list would hold for a booking. */
const entryOf = (
	clientId: string,
	booked: BookedWrite,
	over: Partial<PendingEntry> = {},
): PendingEntry => ({
	clientId,
	bookedAt: NOW,
	changes: booked.changes,
	changed: booked.changed,
	parked: false,
	...over,
});

type Op = Parameters<typeof bookIn>[1];
const book = async (
	store: Awaited<ReturnType<typeof open>>,
	op: Op,
	entries: PendingEntry[] = [],
) =>
	readOverlaid(store, entries, 0, (tx) =>
		bookIn(tx, op, CAUGHT_UP, NOW, entries),
	);

describe("a category write is booked without its name", () => {
	it("keeps the row and the fields it named, and the version it was based on", async () => {
		const store = await open();
		const made = await book(store, makeGifts({ excludeByDefault: true }));
		expect(made.changed).toEqual([]);
		expect(made.categoryBase).toBeUndefined();
		expect(made.changes).toEqual([
			{
				table: "categories",
				id: GIFTS,
				before: null,
				after: {
					id: GIFTS,
					kind: "EXPENSE",
					color: "pink",
					icon: null,
					excludeByDefault: true,
					version: 0,
				},
			},
		]);
		expect(JSON.stringify(made)).not.toContain("Gifts");
		const edited = await book(store, {
			kind: "categoryUpdate",
			body: { id: FOOD, color: "red", name: "Meals" },
		});
		expect(edited.changed).toEqual(["name", "color"]);
		expect(edited.categoryBase).toEqual({ version: 2 });
		expect(edited.changes[0]).toMatchObject({
			table: "categories",
			before: { version: 2, color: "teal" },
			after: { version: 3, color: "red" },
		});
		expect(JSON.stringify(edited)).not.toContain("Meals");
	});
});

describe("the name check sees the device's own unsent names", () => {
	it("refuses a name an unsent create holds, in any spacing, and not one differing by case", async () => {
		const store = await open();
		const made = await book(store, makeGifts());
		const entry = entryOf("c1", made, { categoryNames: { [GIFTS]: "Gifts" } });
		const again = (name: string) =>
			book(
				store,
				{
					kind: "categoryCreate",
					body: { id: uuid(4), name, color: "teal" },
				},
				[entry],
			);
		await expect(again("Gifts ")).rejects.toBeInstanceOf(
			CategoryNameTakenError,
		);
		await expect(again(" Gifts")).rejects.toThrow(
			"Category name already exists",
		);
		expect((await again("gifts")).changes).toHaveLength(1);
	});

	it("sees a rename: the new name is taken and the old one is free", async () => {
		const store = await open();
		const renamed = await book(store, {
			kind: "categoryUpdate",
			body: { id: FOOD, name: "Meals" },
		});
		const entry = entryOf("c1", renamed, {
			categoryNames: { [FOOD]: "Meals" },
		});
		const make = (name: string) =>
			book(
				store,
				{ kind: "categoryCreate", body: { id: uuid(4), name, color: "teal" } },
				[entry],
			);
		await expect(make("Meals")).rejects.toBeInstanceOf(CategoryNameTakenError);
		expect((await make("Food")).changes).toHaveLength(1);
	});

	it("cannot see a name the entry did not hand over (the server stays the authority)", async () => {
		const store = await open();
		const made = await book(store, makeGifts());
		const blind = entryOf("c1", made);
		const second = await book(
			store,
			{
				kind: "categoryCreate",
				body: { id: uuid(4), name: "Gifts", color: "teal" },
			},
			[blind],
		);
		expect(second.changes).toHaveLength(1);
	});

	it("is a refusal the device answers with, not a fault: the server decides", () => {
		for (const error of [
			new CategoryNameTakenError(),
			new IdTakenError(),
			new CategoryChangedError(),
			new InvalidInputError("x"),
		])
			expect(isDeviceRefusal(error)).toBe(true);
	});
});

describe("a write that files into a category the device has not sent", () => {
	it("books an expense into an unsent create, takes its count default, and chains on it", async () => {
		const store = await open();
		const made = await book(store, makeGifts({ excludeByDefault: true }));
		const entry = entryOf("c1", made, { categoryNames: { [GIFTS]: "Gifts" } });
		const booked = await book(store, { kind: "create", body: lunch() }, [
			entry,
		]);
		expect(booked.chainOn).toEqual(["c1"]);
		const row = booked.changes[0];
		expect(row).toMatchObject({
			table: "expenses",
			after: {
				categoryId: GIFTS,
				categoryKind: "EXPENSE",
				excludeFromAnalytics: true,
				homeAmount: "30900.00",
			},
		});
	});

	it("chains on an unsent edit of a pulled category too, and on both when both are unsent", async () => {
		const store = await open();
		const toggle = await book(store, {
			kind: "categoryUpdate",
			body: { id: FOOD, excludeByDefault: true },
		});
		const rename = await book(
			store,
			{ kind: "categoryUpdate", body: { id: FOOD, color: "red" } },
			[entryOf("c1", toggle)],
		);
		const entries = [entryOf("c1", toggle), entryOf("c2", rename)];
		const booked = await book(
			store,
			{ kind: "create", body: lunch({ categoryId: FOOD }) },
			entries,
		);
		expect(booked.chainOn).toEqual(["c1", "c2"]);
		expect(booked.changes[0]).toMatchObject({
			after: { categoryId: FOOD, excludeFromAnalytics: true },
		});
	});

	it("chains a template create and edit, and an expense edit, on the entry", async () => {
		const store = await open();
		const made = await book(store, makeGifts());
		const entries = [entryOf("c1", made)];
		const created = await book(
			store,
			{
				kind: "templateCreate",
				body: {
					id: uuid(20),
					name: "Gift club",
					amount: "20",
					currency: "USD",
					frequency: "MONTHLY",
					nextDueDate: "2026-12-01",
					categoryId: GIFTS,
				},
			},
			entries,
		);
		expect(created.chainOn).toEqual(["c1"]);
		const withTemplate = [...entries, entryOf("t1", created)];
		const edited = await book(
			store,
			{ kind: "templateUpdate", body: { id: uuid(20), categoryId: GIFTS } },
			withTemplate,
		);
		expect(edited.chainOn).toEqual(["c1"]);
		const expenseCreate = await book(
			store,
			{ kind: "create", body: lunch() },
			entries,
		);
		const withExpense = [...entries, entryOf("e1", expenseCreate)];
		const moved = await book(
			store,
			{ kind: "update", body: lunch({ amount: "30" }) },
			withExpense,
		);
		expect(moved.chainOn).toEqual(["c1"]);
	});

	it("waits for nothing once the server has the entry, and for nothing it does not name", async () => {
		const store = await open();
		const made = await book(store, makeGifts());
		const acked = entryOf("c1", made, {
			ack: { version: "0", pull: 1 },
		});
		const booked = await book(store, { kind: "create", body: lunch() }, [
			acked,
		]);
		expect(booked.chainOn).toBeUndefined();
		const other = await book(
			store,
			{ kind: "create", body: lunch({ categoryId: FOOD }) },
			[entryOf("c1", made)],
		);
		expect(other.chainOn).toBeUndefined();
		const none = await book(
			store,
			{ kind: "create", body: lunch({ categoryId: undefined }) },
			[entryOf("c1", made)],
		);
		expect(none.chainOn).toBeUndefined();
	});

	it("does not see a parked entry's category: the booking is refused, as an unknown one", async () => {
		const store = await open();
		const made = await book(store, makeGifts());
		const parked = entryOf("c1", made, { parked: true });
		await expect(
			book(store, { kind: "create", body: lunch() }, [parked]),
		).rejects.toThrow("unknown_category");
		// The chain is still known to whoever needs it (the sender), by the entry.
		expect(chainOnCategory([parked], GIFTS)).toEqual(["c1"]);
	});

	it("names the entries a bulk move into the category waits for", async () => {
		const store = await open();
		await expenseIn(store, "x");
		const made = await book(store, makeGifts({ excludeByDefault: true }));
		const entries = [entryOf("c1", made)];
		const move = (categoryId: string) =>
			readOverlaid(store, entries, 0, (tx) =>
				bookBulkIn(
					tx,
					{ kind: "categorize", categoryId, ids: ["x"] },
					CAUGHT_UP,
					NOW,
					entries,
				),
			);
		const toGifts = await move(GIFTS);
		expect(toGifts.chainOn).toEqual(["c1"]);
		expect(toGifts.reached).toBe(1);
		expect((await move(FOOD)).chainOn).toBeUndefined();
	});
});

describe("the create of a category cannot be taken back while a write names it", () => {
	it("refuses before the category is sent, and after, while an entry names it", async () => {
		const store = await open();
		const made = await book(store, makeGifts());
		const create = entryOf("c1", made);
		const filed = await book(store, { kind: "create", body: lunch() }, [
			create,
		]);
		const dependent = entryOf("e1", filed);
		expect(() => refuseCategoryUncreate([create], GIFTS)).not.toThrow();
		expect(() => refuseCategoryUncreate([create, dependent], GIFTS)).toThrow(
			ConflictError,
		);
		// Sent and accepted, not pulled back yet: the dependent still names it.
		const sent = {
			...create,
			ack: { version: "0", pull: 1 },
		};
		expect(() => refuseCategoryUncreate([sent, dependent], GIFTS)).toThrow(
			ConflictError,
		);
		expect(() => refuseCategoryUncreate([sent], GIFTS)).not.toThrow();
		expect(entryRowsNamingCategory([create, dependent], GIFTS)).toEqual([
			{ table: "expenses", id: uuid(10) },
		]);
	});

	it("refuses for a template too, and not for an entry in another category", async () => {
		const store = await open();
		const made = await book(store, makeGifts());
		const tmpl = await book(
			store,
			{
				kind: "templateCreate",
				body: {
					id: uuid(20),
					name: "Gift club",
					amount: "20",
					currency: "USD",
					frequency: "MONTHLY",
					nextDueDate: "2026-12-01",
					categoryId: GIFTS,
				},
			},
			[entryOf("c1", made)],
		);
		expect(() =>
			refuseCategoryUncreate([entryOf("c1", made), entryOf("t1", tmpl)], GIFTS),
		).toThrow(ConflictError);
		expect(() =>
			refuseCategoryUncreate([entryOf("t1", tmpl)], FOOD),
		).not.toThrow();
	});
});

describe("on the engine", () => {
	const page = (items: unknown[]) => ({
		items,
		tombstones: [],
		cursor: cursor("100"),
		hasMore: false,
	});
	class Pending implements PendingSource {
		list: PendingEntry[] = [];
		entries = () => this.list;
		retire() {}
		takeLeft = () => [];
	}
	const wire = (id: string, name: string, version: number) => ({
		id,
		name,
		color: "teal",
		icon: null,
		isFixed: false,
		excludeByDefault: false,
		kind: "EXPENSE",
		version,
	});
	async function setup() {
		const pending = new Pending();
		const { api } = fakeDeviceApi({
			rates: {
				asOf: "2026-11-01T09:00:00.000Z",
				rates: [
					{
						id: "r1",
						currency: "ARS",
						type: "blue",
						date: "2026-11-01T00:00:00.000Z",
						unitsPerUsd: "1545",
					},
				],
			},
			expenses: [page([expense("x", "10", "2026-11-05T03:00:00.000Z")])],
			categories: [page([wire(FOOD, "Food", 2)])],
			transfers: [page([])],
		});
		const engine: DeviceEngine = createDeviceEngine(api, "u1", () => NOW, {
			pending,
			warn: vi.fn(),
		});
		await engine.pull();
		return { engine, pending };
	}
	beforeEach(() => vi.useRealTimers());

	it("keeps the pulled version, books a rename over it and is null for a name taken", async () => {
		const { engine, pending } = await setup();
		const edit = await engine.book({
			kind: "categoryUpdate",
			body: { id: FOOD, color: "red" },
		});
		expect(edit?.categoryBase).toEqual({ version: 2 });
		expect(
			await engine.book({
				kind: "categoryCreate",
				body: { id: GIFTS, name: "Food ", color: "teal" },
			}),
		).toBeNull();
		const made = await engine.book({
			kind: "categoryCreate",
			body: { id: GIFTS, name: "Gifts", color: "teal" },
		});
		pending.list = [
			entryOf("c1", made as BookedWrite, {
				categoryNames: { [GIFTS]: "Gifts" },
			}),
		];
		expect(
			await engine.book({
				kind: "categoryCreate",
				body: { id: uuid(4), name: "Gifts", color: "teal" },
			}),
		).toBeNull();
		const filed = await engine.book({ kind: "create", body: lunch() });
		expect(filed?.chainOn).toEqual(["c1"]);
	});
});

describe("a category made on the device is taken back through the store", () => {
	async function made() {
		const store = await open();
		const db = new LocalDb(store);
		const { undo } = await db.write(
			"category.create",
			createCategory({ id: GIFTS, name: "Gifts", color: "pink" }),
		);
		return { store, db, undo };
	}

	it("takes it back and brings it back clean while nothing names it", async () => {
		const { store, db, undo } = await made();
		const redo = await db.undo(undo);
		expect(store.get("categories", GIFTS)).toBeUndefined();
		await db.undo(redo);
		expect(store.get("categories", GIFTS)?.name).toBe("Gifts");
	});

	it("refuses while an expense in the store names it", async () => {
		const { store, db, undo } = await made();
		await expenseIn(store, "held", {
			id: GIFTS,
			kind: "EXPENSE",
			excludeByDefault: false,
		});
		await expect(db.undo(undo)).rejects.toBeInstanceOf(ConflictError);
		expect(store.get("categories", GIFTS)?.name).toBe("Gifts");
	});

	it.each([
		["a template", "recurringTemplates"],
		["a share", "shares"],
		["an envelope link", "envelopeCategories"],
	] as const)("refuses while %s names it", async (_name, table) => {
		const { store, db, undo } = await made();
		await store.transaction((tx) =>
			tx.put(table, {
				...fixtureRow(table, "held"),
				categoryId: GIFTS,
			} as never),
		);
		await expect(db.undo(undo)).rejects.toBeInstanceOf(ConflictError);
		expect(store.get("categories", GIFTS)?.name).toBe("Gifts");
	});

	it("puts an edit's replaced fields back, and refuses once another edit moved the row", async () => {
		const store = await open();
		const db = new LocalDb(store);
		const { undo } = await db.write(
			"category.update",
			updateCategory({ id: FOOD, color: "red", excludeByDefault: true }),
		);
		expect(store.get("categories", FOOD)).toMatchObject({
			color: "red",
			excludeByDefault: true,
			version: 3,
		});
		await db.undo(undo);
		expect(store.get("categories", FOOD)).toMatchObject({
			color: "teal",
			excludeByDefault: false,
			version: 2,
		});
		await db.write(
			"category.update",
			updateCategory({ id: FOOD, color: "red" }),
		);
		await db.write(
			"category.update",
			updateCategory({ id: FOOD, icon: "cart" }),
		);
		await expect(db.undo(undo)).rejects.toBeInstanceOf(ConflictError);
		expect(store.get("categories", FOOD)?.icon).toBe("cart");
	});
});
