import {
	AMOUNT_ABOVE_ZERO,
	CATEGORY_NOT_FOUND,
	EXPENSE_NOT_FOUND,
	LEG_DELETE_REFUSED,
	LEG_EDIT_REFUSED,
	otherHomeMessage,
	SPREAD_NOT_ON_DEVICE,
} from "@retrospend/domain/expense-write/refusals";
import { MissingRateError } from "@retrospend/domain/money";
import { describe, expect, it } from "vitest";
import {
	type CreateExpenseInput,
	createExpense,
	EXPENSE_CREATE,
} from "./expense-create";
import { expenseEditCases } from "./expense-edit-conformance";
import { editVectors } from "./expense-edit-vectors";
import {
	deleteExpense,
	EXPENSE_DELETE,
	EXPENSE_UPDATE,
	SYNC_FIRST,
	type UpdateExpenseInput,
	updateExpense,
} from "./expense-write-local";
import type { ExpenseRow } from "./expenses";
import {
	ConflictError,
	InvalidInputError,
	LocalDb,
	NotFoundError,
	TABLE_NAMES,
} from "./index";
import { localExpenseEditAdapter } from "./local-expense-edit";
import { seededStore } from "./local-expense-create";
import {
	createDevicePreviewRunner,
	EXPENSE_DELETE_MUTATION,
	EXPENSE_UPDATE_MUTATION,
} from "./preview";
import { deviceFigures } from "./registry";

describe("expense edit conformance (memory store)", () => {
	for (const c of expenseEditCases(editVectors))
		it(c.name, () => c.run(localExpenseEditAdapter));
});

// ARS home, USD 100 at blue 1545 on 2026-03-05: home amount 154,500.00.
const first = editVectors[0] as (typeof editVectors)[number];
const BASE: CreateExpenseInput = first.base;

const form = (over: Partial<UpdateExpenseInput> = {}): UpdateExpenseInput => ({
	id: BASE.id,
	title: "Lunch",
	amount: "100",
	currency: "USD",
	date: BASE.date,
	transfersSynced: true,
	...over,
});

const dump = (store: Awaited<ReturnType<typeof seededStore>>) =>
	Object.fromEntries(TABLE_NAMES.map((t) => [t, store.list(t)]));

async function open() {
	const store = await seededStore(first.seed);
	const db = new LocalDb(store);
	await db.write(EXPENSE_CREATE, createExpense(BASE));
	const row = store.get("expenses", "e1") as ExpenseRow;
	/** Puts a row (or other table row) in the store the way a pull would. */
	const put = (fn: Parameters<typeof store.transaction>[0]) =>
		store.transaction(fn);
	return { store, db, row, put };
}

/** The write is refused with `kind` and `message`, and nothing changes. */
async function refuses(
	run: (db: LocalDb) => Promise<unknown>,
	store: Awaited<ReturnType<typeof seededStore>>,
	db: LocalDb,
	kind: new (...a: never[]) => Error,
	message: string,
) {
	const before = dump(store);
	const error = await run(db).catch((e) => e);
	expect(error).toBeInstanceOf(kind);
	expect((error as Error).message).toBe(message);
	expect(dump(store)).toEqual(before);
}

const update = (db: LocalDb, over: Partial<UpdateExpenseInput> = {}) =>
	db.write(EXPENSE_UPDATE, updateExpense(form(over)));
const remove = (db: LocalDb, id = "e1", transfersSynced = true) =>
	db.write(EXPENSE_DELETE, deleteExpense({ id, transfersSynced }));

describe("what the device writes on an edit", () => {
	it("keeps the version, the text it was not given and the rate legs, and changes what the form changed", async () => {
		const { store, db, put } = await open();
		await put((tx) => {
			const row = tx.get("expenses", "e1") as ExpenseRow;
			tx.put("expenses", { ...row, version: "2026-03-05T16:00:00.000Z" });
		});
		const { value } = await update(db, {
			title: "Dinner",
			amount: "120",
			location: "Cafe",
		});
		expect(store.get("expenses", "e1")).toEqual(value);
		expect(value).toMatchObject({
			title: "Dinner",
			location: "Cafe",
			description: null,
			amount: "120",
			amountInUSD: "120.00",
			homeRate: "1545",
			homeAmount: "185400.00",
			version: "2026-03-05T16:00:00.000Z",
			pricingSource: "MANUAL",
			status: "FINALIZED",
			direction: "OUT",
		});
	});

	it("a category change takes its kind and its default exclusion; an unchanged one is left alone", async () => {
		const { store, db, put } = await open();
		await put((tx) => {
			tx.put("categories", {
				id: "c1",
				kind: "EXPENSE",
				name: "Food",
				color: "teal",
				icon: null,
				excludeByDefault: true,
			});
		});
		const { value } = await update(db, { categoryId: "c1" });
		expect(value).toMatchObject({
			categoryId: "c1",
			categoryKind: "EXPENSE",
			excludeFromAnalytics: true,
		});
		// The form leaves the flag unset and the category is unchanged: the row keeps it.
		await update(db, { categoryId: "c1", title: "Again" });
		expect(store.get("expenses", "e1")).toMatchObject({
			excludeFromAnalytics: true,
		});
		// The category leaves; the kind goes with it.
		await update(db, { excludeFromAnalytics: false });
		expect(store.get("expenses", "e1")).toMatchObject({
			categoryId: null,
			categoryKind: null,
			excludeFromAnalytics: false,
		});
	});

	it("a pulled category the row keeps stays editable even when it is an income category", async () => {
		const { store, db, put } = await open();
		await put((tx) => {
			tx.put("categories", {
				id: "inc",
				kind: "INCOME",
				name: "Pay",
				color: "teal",
				icon: null,
				excludeByDefault: false,
			});
			const row = tx.get("expenses", "e1") as ExpenseRow;
			tx.put("expenses", { ...row, categoryId: "inc", categoryKind: "INCOME" });
		});
		await update(db, { categoryId: "inc", title: "Renamed" });
		expect(store.get("expenses", "e1")).toMatchObject({
			title: "Renamed",
			categoryId: "inc",
			categoryKind: "INCOME",
		});
	});
});

describe("refusals, each reached on its own", () => {
	it("a transfer's fee: money edits and deletes are refused with the server's words", async () => {
		const { store, db, put } = await open();
		await put((tx) =>
			tx.put("transfers", {
				id: "t1",
				date: BASE.date,
				toAccountId: null,
				toAmount: "0",
				toCurrency: "USD",
				feeExpenseId: "e1",
			}),
		);
		await refuses(
			(d) => update(d, { amount: "120" }),
			store,
			db,
			InvalidInputError,
			LEG_EDIT_REFUSED,
		);
		await refuses(
			(d) => remove(d),
			store,
			db,
			InvalidInputError,
			LEG_DELETE_REFUSED,
		);
		// A title edit moves no money: still allowed.
		await update(db, { title: "Fee" });
		expect(store.get("expenses", "e1")?.title).toBe("Fee");
	});

	for (const [name, patch] of [
		["a spread part", { isAmortizedChild: true }],
		["an income row", { direction: "IN" }],
	] as const)
		it(`${name} is not found, as on the server`, async () => {
			const { store, db, put, row } = await open();
			await put((tx) => tx.put("expenses", { ...row, id: "other", ...patch }));
			await refuses(
				(d) => update(d, { id: "other" }),
				store,
				db,
				NotFoundError,
				EXPENSE_NOT_FOUND,
			);
			await refuses(
				(d) => remove(d, "other"),
				store,
				db,
				NotFoundError,
				EXPENSE_NOT_FOUND,
			);
		});

	it("a shared expense is not found", async () => {
		const { store, db, put } = await open();
		await put((tx) =>
			tx.put("shares", {
				id: "s1",
				expenseId: "e1",
				shareAmount: "50",
				verificationStatus: "ACCEPTED",
				currency: "USD",
				date: BASE.date,
				projectId: null,
				exchangeRate: null,
				categoryId: null,
			}),
		);
		await refuses(
			(d) => update(d),
			store,
			db,
			NotFoundError,
			EXPENSE_NOT_FOUND,
		);
		await refuses(
			(d) => remove(d),
			store,
			db,
			NotFoundError,
			EXPENSE_NOT_FOUND,
		);
	});

	it("a spread parent is refused for an edit and a delete", async () => {
		const { store, db, put, row } = await open();
		await put((tx) => tx.put("expenses", { ...row, isAmortizedParent: true }));
		await refuses(
			(d) => update(d),
			store,
			db,
			InvalidInputError,
			SPREAD_NOT_ON_DEVICE,
		);
		await refuses(
			(d) => remove(d),
			store,
			db,
			InvalidInputError,
			SPREAD_NOT_ON_DEVICE,
		);
	});

	it("a form that asks for a spread is refused", async () => {
		const { store, db } = await open();
		await refuses(
			(d) => update(d, { amortizeOver: 3 }),
			store,
			db,
			InvalidInputError,
			SPREAD_NOT_ON_DEVICE,
		);
	});

	it("before the transfers have been pulled, an edit and a delete say Sync first", async () => {
		const { store, db } = await open();
		await refuses(
			(d) => update(d, { transfersSynced: false }),
			store,
			db,
			InvalidInputError,
			SYNC_FIRST,
		);
		await refuses(
			(d) => remove(d, "e1", false),
			store,
			db,
			InvalidInputError,
			SYNC_FIRST,
		);
	});

	it("an id that is not there is not found", async () => {
		const { store, db } = await open();
		await refuses(
			(d) => update(d, { id: "nope" }),
			store,
			db,
			NotFoundError,
			EXPENSE_NOT_FOUND,
		);
		await refuses(
			(d) => remove(d, "nope"),
			store,
			db,
			NotFoundError,
			EXPENSE_NOT_FOUND,
		);
	});

	it("an income or unknown category on an edit is Category not found", async () => {
		const { store, db, put } = await open();
		await put((tx) =>
			tx.put("categories", {
				id: "inc",
				kind: "INCOME",
				name: "Pay",
				color: "teal",
				icon: null,
				excludeByDefault: false,
			}),
		);
		for (const categoryId of ["inc", "missing"])
			await refuses(
				(d) => update(d, { categoryId }),
				store,
				db,
				InvalidInputError,
				CATEGORY_NOT_FOUND,
			);
	});

	it("a typed rate pinned to another home is refused, and zero and a missing rate block the save", async () => {
		const { store, db } = await open();
		await refuses(
			(d) =>
				update(d, {
					customRate: { base: "USD", value: "1500", home: "EUR" },
				}),
			store,
			db,
			InvalidInputError,
			otherHomeMessage("EUR"),
		);
		await refuses(
			(d) => update(d, { amount: "0" }),
			store,
			db,
			InvalidInputError,
			AMOUNT_ABOVE_ZERO,
		);
		await expect(update(db, { currency: "CLP" })).rejects.toBeInstanceOf(
			MissingRateError,
		);
	});
});

describe("undo", () => {
	it("puts the row back, and redo the edit", async () => {
		const { store, db } = await open();
		const before = dump(store);
		const { undo } = await update(db, { amount: "120" });
		const after = dump(store);
		expect(undo).toMatchObject({
			kind: "revert",
			mutation: EXPENSE_UPDATE,
			home: "ARS",
		});
		const redo = await db.undo(undo);
		expect(dump(store)).toEqual(before);
		await db.undo(redo);
		expect(dump(store)).toEqual(after);
	});

	it("is refused once the home currency changed, and writes nothing", async () => {
		const { store, db, put } = await open();
		const { undo } = await update(db, { amount: "120" });
		await put((tx) => {
			const s = tx.get("settings", "user");
			if (s) tx.put("settings", { ...s, homeCurrency: "EUR" });
		});
		const edited = dump(store);
		await expect(db.undo(undo)).rejects.toBeInstanceOf(ConflictError);
		expect(dump(store)).toEqual(edited);
	});

	it("a delete's undo brings the row back verbatim; a create's token carries no home", async () => {
		const { store, db, row } = await open();
		const { undo } = await remove(db);
		expect(store.get("expenses", "e1")).toBeUndefined();
		expect(undo).not.toHaveProperty("home");
		await db.undo(undo);
		expect(store.get("expenses", "e1")).toEqual(row);
	});
});

describe("preview and apply", () => {
	async function runner() {
		const { store, db } = await open();
		const figures = deviceFigures({ clock: () => BASE.date });
		return {
			store,
			db,
			runner: createDevicePreviewRunner({
				store,
				figures,
				actor: { userId: "u1" },
			}),
		};
	}

	it("an edit previews what it changes and apply makes exactly that", async () => {
		const { store, runner: r } = await runner();
		const before = dump(store);
		const preview = await r.preview(
			EXPENSE_UPDATE_MUTATION,
			form({ amount: "120" }),
		);
		expect(dump(store)).toEqual(before);
		// USD 100 to 120 is +USD 20.00; in ARS at the kept blue 1545 it is
		// 185,400.00 - 154,500.00 = +30,900.00.
		expect(preview.changes).toEqual([
			expect.objectContaining({
				id: "spent",
				delta: { minor: 2_000, currency: "USD" },
			}),
			expect.objectContaining({
				id: "glance.spent",
				delta: { minor: 3_090_000, currency: "ARS" },
			}),
		]);
		const { undo, ...applied } = await r.apply(
			EXPENSE_UPDATE_MUTATION,
			form({ amount: "120" }),
		);
		expect(applied).toEqual(preview);
		expect(undo).toMatchObject({ mutation: EXPENSE_UPDATE, home: "ARS" });
	});

	it("a delete previews the spending it removes and its undo restores it", async () => {
		const { store, runner: r } = await runner();
		const before = dump(store);
		const preview = await r.preview(EXPENSE_DELETE_MUTATION, {
			id: "e1",
			transfersSynced: true,
		});
		// The row is USD 100 = ARS 154,500.00 at blue 1545.
		expect(preview.changes).toEqual([
			expect.objectContaining({
				id: "spent",
				delta: { minor: -10_000, currency: "USD" },
			}),
			expect.objectContaining({
				id: "glance.spent",
				delta: { minor: -15_450_000, currency: "ARS" },
			}),
		]);
		const { undo } = await r.apply(EXPENSE_DELETE_MUTATION, {
			id: "e1",
			transfersSynced: true,
		});
		expect(store.get("expenses", "e1")).toBeUndefined();
		await new LocalDb(store).undo(undo);
		expect(dump(store)).toEqual(before);
	});
});

describe("amounts in home currency, by hand", () => {
	it("ARS blue 1545: 100 to 120 adds 30,900.00 to the home amount and a delete removes 185,400.00", async () => {
		const { store, db } = await open();
		const home = () => store.get("expenses", "e1")?.homeAmount;
		expect(home()).toBe("154500.00");
		await update(db, { amount: "120" });
		expect(home()).toBe("185400.00");
		const preview = await db.preview(
			deleteExpense({ id: "e1", transfersSynced: true }),
		);
		expect(preview.changes).toHaveLength(1);
		expect(preview.changes[0]).toMatchObject({
			table: "expenses",
			after: null,
		});
		// 185,400.00 - 154,500.00 = 30,900.00 up, then all of 185,400.00 gone.
		expect(preview.changes[0]?.before).toMatchObject({
			homeAmount: "185400.00",
		});
	});
});

// The engine package has no node types; the host zone is the process's.
const env = (
	globalThis as unknown as {
		process: { env: Record<string, string | undefined> };
	}
).process.env;

describe("zone and month edges with a process zone other than UTC", () => {
	it("the vectors hold with TZ set to Pacific/Kiritimati", async () => {
		const was = env.TZ;
		env.TZ = "Pacific/Kiritimati";
		try {
			// UTC+14: the host's own day is not the person's day.
			expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-840);
			for (const c of expenseEditCases(
				editVectors.filter((v) => v.name.startsWith("Buenos Aires")),
			))
				await c.run(localExpenseEditAdapter);
		} finally {
			if (was === undefined) delete env.TZ;
			else env.TZ = was;
		}
	});
});
