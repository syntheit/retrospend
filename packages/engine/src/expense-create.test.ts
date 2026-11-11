import { MissingRateError } from "@retrospend/domain/money";
import {
	spentInputsFromRows,
	spentMinorByCurrency,
} from "@retrospend/domain/spent";
import { describe, expect, it } from "vitest";
import {
	type CreateExpenseInput,
	createExpense,
	EXPENSE_CREATE,
} from "./expense-create";
import { expenseCreateCases } from "./expense-create-conformance";
import { vectors } from "./expense-create-vectors";
import {
	ConflictError,
	InvalidInputError,
	LocalDb,
	NotFoundError,
	TABLE_NAMES,
} from "./index";
import {
	localExpenseCreateAdapter,
	seededStore,
} from "./local-expense-create";

describe("expense create conformance (memory store)", () => {
	for (const c of expenseCreateCases)
		it(c.name, () => c.run(localExpenseCreateAdapter));
});

// The first vector: USD 100 into an ARS home at blue 1545 on 2026-03-05.
const first = vectors[0] as (typeof vectors)[number];
const entry = (over: Partial<CreateExpenseInput> = {}): CreateExpenseInput => ({
	...first.input,
	...over,
});

const dump = (store: Awaited<ReturnType<typeof seededStore>>) =>
	Object.fromEntries(TABLE_NAMES.map((t) => [t, store.list(t)]));

async function open() {
	const store = await seededStore(first.seed);
	return { store, db: new LocalDb(store) };
}

describe("expense create on the local store", () => {
	it("stores the text, the pricing source and both rate legs on the row", async () => {
		const { store, db } = await open();
		await db.write(
			EXPENSE_CREATE,
			createExpense(
				entry({ title: "Lunch", location: "Cafe", description: "with Ana" }),
			),
		);
		expect(store.get("expenses", "e1")).toMatchObject({
			title: "Lunch",
			location: "Cafe",
			description: "with Ana",
			pricingSource: "MANUAL",
			exchangeRate: "1",
			rateType: "blue",
			homeRate: "1545",
			homeAmount: "154500.00",
			amountInUSD: "100.00",
		});
	});

	it("undo puts back exactly what was there, and redo the created row", async () => {
		const { store, db } = await open();
		await db.write("expense.create", createExpense(entry({ id: "old" })));
		const before = dump(store);
		const { undo } = await db.write(
			EXPENSE_CREATE,
			createExpense(entry({ id: "e2", amount: "7" })),
		);
		const after = dump(store);
		expect(undo).toMatchObject({ kind: "revert", mutation: EXPENSE_CREATE });
		const redo = await db.undo(undo);
		expect(dump(store)).toEqual(before);
		await db.undo(redo);
		expect(dump(store)).toEqual(after);
	});

	it("undo refuses once the expense was edited, and writes nothing", async () => {
		const { store, db } = await open();
		const { value, undo } = await db.write(
			EXPENSE_CREATE,
			createExpense(entry()),
		);
		await db.write("expense.update", (r) =>
			r.expenses.update({ expense: { ...value, amount: "99" }, shares: [] }),
		);
		const edited = dump(store);
		await expect(db.undo(undo)).rejects.toBeInstanceOf(ConflictError);
		expect(dump(store)).toEqual(edited);
	});

	it("a preview is the write rolled back: same row, nothing stored", async () => {
		const { store, db } = await open();
		const before = dump(store);
		const preview = await db.preview(createExpense(entry()));
		expect(dump(store)).toEqual(before);
		expect(preview.changes).toHaveLength(1);
		expect(preview.changes[0]).toMatchObject({
			table: "expenses",
			id: "e1",
			before: null,
			after: preview.value,
		});
		const written = await db.write(EXPENSE_CREATE, createExpense(entry()));
		expect(written.value).toEqual(preview.value);
	});

	it("a failed create writes nothing, even after the id was checked", async () => {
		const { store, db } = await open();
		const before = dump(store);
		await expect(
			db.write(
				EXPENSE_CREATE,
				createExpense(entry({ currency: "EUR", amount: "5" })),
			),
		).resolves.toBeDefined();
		const { currency: _c, ...rest } = entry();
		await expect(
			db.write(
				EXPENSE_CREATE,
				createExpense({ ...rest, id: "e9", currency: "BRL" }),
			),
		).rejects.toBeInstanceOf(MissingRateError);
		expect(store.get("expenses", "e9")).toBeUndefined();
		expect(store.list("expenses").map((e) => e.id)).toEqual(["e1"]);
		expect(dump(store)).not.toEqual(before);
	});

	describe("analytics exclusion", () => {
		const category = { id: "c1", kind: "EXPENSE", excludeByDefault: true };
		const excluded = async (over: Partial<CreateExpenseInput>) => {
			const { store, db } = await open();
			await db.write(EXPENSE_CREATE, createExpense(entry(over)));
			return store.get("expenses", "e1");
		};

		it("takes the category's default when the form says nothing", async () => {
			expect(await excluded({ category })).toMatchObject({
				excludeFromAnalytics: true,
				categoryId: "c1",
				categoryKind: "EXPENSE",
			});
		});
		it("an explicit choice beats the category", async () => {
			expect(
				await excluded({ category, excludeFromAnalytics: false }),
			).toMatchObject({ excludeFromAnalytics: false });
		});
		it("a project's expense always counts", async () => {
			expect(
				await excluded({
					category,
					excludeFromAnalytics: true,
					projectId: "p1",
				}),
			).toMatchObject({ excludeFromAnalytics: false });
		});
	});

	describe("refusals", () => {
		const refused = async (
			over: Partial<CreateExpenseInput>,
			kind: new (...a: never[]) => Error = InvalidInputError,
		) => {
			const { store, db } = await open();
			const before = dump(store);
			await expect(
				db.write(EXPENSE_CREATE, createExpense(entry(over))),
			).rejects.toBeInstanceOf(kind);
			expect(dump(store)).toEqual(before);
		};

		it("an amount that is not a number", async () => {
			await refused({ amount: "12,5" });
			await refused({ amount: Number.NaN });
			await refused({ amount: "" });
		});
		it("an unknown currency code or an invalid date", async () => {
			await refused({ currency: "usd" });
			await refused({ date: new Date(Number.NaN) });
		});
		it("an income category", () =>
			refused({ category: { id: "c", kind: "INCOME", excludeByDefault: false } }));
		it("spreading over months, which needs parts the port has no row for", () =>
			refused({ amortizeOver: 3 }));
		it("a custom type with no rate, and a custom rate for the home currency", async () => {
			await refused({ currency: "EUR", rateType: "custom" });
			await refused({ currency: "ARS", customRate: { base: "ARS", value: "2" } });
			await refused({ customRate: { base: "USD", value: "0" } });
		});
		it("an id already in use", async () => {
			const { store, db } = await open();
			await db.write(EXPENSE_CREATE, createExpense(entry()));
			await expect(
				db.write(EXPENSE_CREATE, createExpense(entry())),
			).rejects.toBeInstanceOf(InvalidInputError);
			expect(store.list("expenses")).toHaveLength(1);
		});
	});

	it("a created expense lands in the spending figure in its own currency", async () => {
		// USD 100 is 10000 USD minor; ARS 1000.50 at 2 decimals is 100050 ARS minor.
		const { store, db } = await open();
		await db.write(EXPENSE_CREATE, createExpense(entry()));
		await db.write(
			EXPENSE_CREATE,
			createExpense(entry({ id: "e2", amount: "1000.50", currency: "ARS" })),
		);
		const inputs = spentInputsFromRows({
			expenses: store.list("expenses"),
			shares: [],
			hiddenProjectIds: [],
			range: {
				start: new Date("2026-03-01T03:00:00Z"),
				end: new Date("2026-04-01T02:59:59.999Z"),
			},
		});
		expect(
			spentMinorByCurrency(inputs).sort((a, b) =>
				a.currency < b.currency ? -1 : 1,
			),
		).toEqual([
			{ minor: 100050, currency: "ARS" },
			{ minor: 10000, currency: "USD" },
		]);
	});
});

describe("a store with no settings", () => {
	it("cannot price: NotFoundError, nothing written", async () => {
		const store = await seededStore(first.seed);
		await store.transaction((tx) => tx.delete("settings", "user"));
		const db = new LocalDb(store);
		await expect(
			db.write(EXPENSE_CREATE, createExpense(entry())),
		).rejects.toBeInstanceOf(NotFoundError);
		expect(store.list("expenses")).toEqual([]);
	});
});
