import {
	AMOUNT_ABOVE_ZERO,
	CATEGORY_NOT_FOUND,
	EXPENSE_NOT_FOUND,
	LEG_DELETE_REFUSED,
	LEG_EDIT_REFUSED,
	otherHomeMessage,
	SPREAD_NOT_ON_DEVICE,
	UNDO_NOT_VALID,
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
	type Tx,
} from "./index";
import { cursor } from "./device/fake-api";
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

/** Transfers pulled as far as expenses. */
const CAUGHT_UP = { expenses: cursor("200"), transfers: cursor("200") };

const form = (over: Partial<UpdateExpenseInput> = {}): UpdateExpenseInput => ({
	id: BASE.id,
	title: "Lunch",
	amount: "100",
	currency: "USD",
	date: BASE.date,
	cursors: CAUGHT_UP,
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
const remove = (
	db: LocalDb,
	id = "e1",
	cursors: UpdateExpenseInput["cursors"] = CAUGHT_UP,
) => db.write(EXPENSE_DELETE, deleteExpense({ id, cursors }));

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
				version: 0,
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
				version: 0,
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
				kind: "TRANSFER",
				fromAccountId: null,
				fromAmount: "0",
				countedFromUnits: "0",
				countedToUnits: "0",
				note: null,
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

	it("an unknown currency code and an invalid date are refused on an edit", async () => {
		const { store, db } = await open();
		await refuses(
			(d) => update(d, { currency: "usd" }),
			store,
			db,
			InvalidInputError,
			"Unknown currency usd",
		);
		await refuses(
			(d) => update(d, { date: new Date(Number.NaN) }),
			store,
			db,
			InvalidInputError,
			"Pick a valid date",
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

	describe("Sync first", () => {
		// A fee is only known by its transfer: the transfers pull must have
		// reached the position the expenses pull did.
		const cases = [
			["no cursors yet", {}],
			["expenses with no transfers pulled", { expenses: cursor("200") }],
			[
				"a transfers pull behind the expenses pull",
				{ expenses: cursor("200"), transfers: cursor("100") },
			],
			[
				"a transfers pull of another epoch",
				{ expenses: cursor("200"), transfers: cursor("300", "e2") },
			],
			[
				"transfers being pulled again after a reset",
				{ expenses: cursor("200"), transfers: "reset" },
			],
			[
				"expenses being pulled again after a reset",
				{ expenses: "reset", transfers: cursor("300") },
			],
		] as const;
		for (const [name, cursors] of cases)
			it(`${name}: an edit and a delete are refused`, async () => {
				const { store, db } = await open();
				await refuses(
					(d) => update(d, { cursors }),
					store,
					db,
					InvalidInputError,
					SYNC_FIRST,
				);
				await refuses(
					(d) => remove(d, "e1", cursors),
					store,
					db,
					InvalidInputError,
					SYNC_FIRST,
				);
			});

		it("a fee pulled with the expenses whose transfer has not arrived is not edited as an expense", async () => {
			// The transfers pull is behind: nothing says e1 is a fee yet.
			const { store, db, put } = await open();
			const behind = { expenses: cursor("200"), transfers: cursor("100") };
			await refuses(
				(d) => update(d, { amount: "120", cursors: behind }),
				store,
				db,
				InvalidInputError,
				SYNC_FIRST,
			);
			// Once the transfers arrive, the same edit is the fee's refusal.
			await put((tx) =>
				tx.put("transfers", {
					id: "t1",
					kind: "TRANSFER",
					fromAccountId: null,
					fromAmount: "0",
					countedFromUnits: "0",
					countedToUnits: "0",
					note: null,
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
		});

		it("transfers pulled at the same position as expenses, or later, pass", async () => {
			const { store, db } = await open();
			await update(db, { cursors: CAUGHT_UP, title: "Same" });
			await update(db, {
				cursors: { expenses: cursor("200"), transfers: cursor("250") },
				title: "Later",
			});
			expect(store.get("expenses", "e1")?.title).toBe("Later");
		});
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
				version: 0,
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

	const changeHome = (put: Awaited<ReturnType<typeof open>>["put"]) =>
		put((tx) => {
			const s = tx.get("settings", "user");
			if (s) tx.put("settings", { ...s, homeCurrency: "EUR" });
		});

	it("a table rate's undo after the home changed says this undo is not valid, and writes nothing", async () => {
		const { store, db, put } = await open();
		const { undo } = await update(db, { amount: "120" });
		await changeHome(put);
		const edited = dump(store);
		const error = await db.undo(undo).catch((e) => e);
		expect(error).toBeInstanceOf(InvalidInputError);
		expect(error.message).toBe(UNDO_NOT_VALID);
		expect(dump(store)).toEqual(edited);
	});

	it("a typed rate's undo after the home changed names the home it was into", async () => {
		const { store, db, put } = await open();
		await put((tx) => {
			const row = tx.get("expenses", "e1") as ExpenseRow;
			tx.put("expenses", { ...row, rateType: "custom", homeRate: "1600" });
		});
		const { undo } = await update(db, { title: "Renamed" });
		await changeHome(put);
		const edited = dump(store);
		const error = await db.undo(undo).catch((e) => e);
		expect(error).toBeInstanceOf(InvalidInputError);
		expect(error.message).toBe(otherHomeMessage("ARS"));
		expect(dump(store)).toEqual(edited);
	});

	it("a typed rate booked into an old home refuses the undo even when the edit ran after the home changed", async () => {
		const { store, db, put } = await open();
		await put((tx) => {
			const row = tx.get("expenses", "e1") as ExpenseRow;
			tx.put("expenses", { ...row, rateType: "custom", homeRate: "1600" });
		});
		// The home changes first, so the edit's token pins EUR.
		await changeHome(put);
		const { undo } = await update(db, {
			title: "Renamed",
			customRate: { base: "USD", value: "1600" },
		});
		expect(undo).toMatchObject({ home: "EUR" });
		const edited = dump(store);
		const error = await db.undo(undo).catch((e) => e);
		expect(error).toBeInstanceOf(InvalidInputError);
		expect(error.message).toBe(otherHomeMessage("ARS"));
		expect(dump(store)).toEqual(edited);
	});

	it("a table rate's undo with the home changed and the old category gone says Category not found first", async () => {
		const { store, db, put } = await open();
		await put((tx) => {
			for (const id of ["c1", "c2"])
				tx.put("categories", {
					id,
					kind: "EXPENSE",
					name: id,
					color: "teal",
					icon: null,
					excludeByDefault: false,
					version: 0,
				});
		});
		await update(db, { categoryId: "c1" });
		const { undo } = await update(db, { categoryId: "c2" });
		await put((tx) => tx.delete("categories", "c1"));
		await changeHome(put);
		const edited = dump(store);
		const error = await db.undo(undo).catch((e) => e);
		expect(error).toBeInstanceOf(InvalidInputError);
		expect(error.message).toBe(CATEGORY_NOT_FOUND);
		expect(dump(store)).toEqual(edited);
	});

	describe("categories gone since", () => {
		const food = (kind = "EXPENSE") => ({
			id: "c1",
			kind,
			name: "Food",
			color: "teal",
			icon: null,
			excludeByDefault: false,
			version: 0,
		});
		const withCategory = async () => {
			const o = await open();
			await o.put((tx) => {
				tx.put("categories", food());
				tx.put("categories", { ...food(), id: "c2", name: "Other" });
				const row = tx.get("expenses", "e1") as ExpenseRow;
				tx.put("expenses", {
					...row,
					categoryId: "c1",
					categoryKind: "EXPENSE",
				});
			});
			return o;
		};

		for (const [name, change] of [
			["is gone", (tx: Tx) => tx.delete("categories", "c1")],
			[
				"is now an income category",
				(tx: Tx) => tx.put("categories", food("INCOME")),
			],
		] as const)
			it(`an edit's undo is refused when the old category ${name}`, async () => {
				const { store, db, put } = await withCategory();
				const { undo } = await update(db, { categoryId: "c2" });
				await put(change);
				const edited = dump(store);
				const error = await db.undo(undo).catch((e) => e);
				expect(error).toBeInstanceOf(InvalidInputError);
				expect(error.message).toBe(CATEGORY_NOT_FOUND);
				expect(dump(store)).toEqual(edited);
			});

		it("an edit's undo keeps working when the category did not change", async () => {
			const { store, db, put } = await withCategory();
			const { undo } = await update(db, { categoryId: "c1", amount: "120" });
			await put((tx) => tx.delete("categories", "c1"));
			// The row still names c1 and the edit never moved it: nothing to refuse.
			await db.undo(undo);
			expect(store.get("expenses", "e1")?.amount).toBe("100");
		});

		it("a delete's undo drops a gone category and template and reads the kind again", async () => {
			const { store, db, put } = await withCategory();
			await put((tx) => {
				const row = tx.get("expenses", "e1") as ExpenseRow;
				tx.put("expenses", { ...row, recurringTemplateId: "rt1" });
			});
			const { undo } = await remove(db);
			await put((tx) => tx.delete("categories", "c1"));
			const redo = await db.undo(undo);
			expect(store.get("expenses", "e1")).toMatchObject({
				categoryId: null,
				categoryKind: null,
				recurringTemplateId: null,
			});
			// The redo expects the row it was given, and deletes it.
			await db.undo(redo);
			expect(store.get("expenses", "e1")).toBeUndefined();
		});

		it("a delete's undo keeps a category that is still there, with the kind it has now", async () => {
			const { store, db, put } = await withCategory();
			const { undo } = await remove(db);
			await put((tx) => tx.put("categories", food("INCOME")));
			await db.undo(undo);
			expect(store.get("expenses", "e1")).toMatchObject({
				categoryId: "c1",
				categoryKind: "INCOME",
			});
		});
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
			cursors: CAUGHT_UP,
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
			cursors: CAUGHT_UP,
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
			deleteExpense({ id: "e1", cursors: CAUGHT_UP }),
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
			for (const c of expenseEditCases(editVectors).filter((c) =>
				c.name.startsWith("Buenos Aires"),
			))
				await c.run(localExpenseEditAdapter);
		} finally {
			if (was === undefined) delete env.TZ;
			else env.TZ = was;
		}
	});
});
