import { describe, expect, it, vi } from "vitest";
import {
	createFiguresRegistry,
	type FigureDefinition,
	FigureError,
	FigureRegistryError,
	type Money,
} from "~/server/figures/registry";
import { createPreviewRunner } from "./runner";
import type {
	MoneyMutation,
	TransactionPurpose,
	TransactionRunner,
} from "./types";

/** A tiny ledger in ARS minor units: what each person owes you (negative = you owe them) and your cash. */
interface Book {
	balances: Record<string, number>;
	cash: number;
}
interface FakeTx {
	book: Book;
}

/** Works on a copy and keeps it only when `work` resolves, like a real transaction. */
function fakeDatabase(initial: Book) {
	let committed = structuredClone(initial);
	let commits = 0;
	const purposes: TransactionPurpose[] = [];
	const transaction: TransactionRunner<FakeTx> = async (work, purpose) => {
		purposes.push(purpose);
		const tx = { book: structuredClone(committed) };
		const result = await work(tx);
		committed = tx.book;
		commits += 1;
		return result;
	};
	return {
		transaction,
		purposes,
		book: () => committed,
		commits: () => commits,
	};
}

const ars = (minor: number): Money => ({ minor, currency: "ARS" });

const owedToYou: FigureDefinition<FakeTx> = {
	id: "owed.owedToYou",
	scope: [],
	compute: async ({ book }) =>
		ars(Object.values(book.balances).reduce((t, b) => t + Math.max(b, 0), 0)),
};
const withPerson: FigureDefinition<FakeTx> = {
	id: "balance.withPerson",
	scope: ["personId"],
	compute: async ({ book }, scope) =>
		scope.personId === undefined
			? null
			: ars(book.balances[scope.personId] ?? 0),
};
const netWorth: FigureDefinition<FakeTx> = {
	id: "netWorth",
	scope: [],
	inEveryPreview: true,
	compute: async ({ book }) => ars(book.cash),
};

const registry = createFiguresRegistry([owedToYou, withPerson, netWorth]);

interface SettleInput {
	personId: string;
	minor: number;
}

/** "They paid you back" with no account picked: only the balance moves (N75 middle option). */
const settle: MoneyMutation<SettleInput, { paid: number }, FakeTx> = {
	id: "test.settle",
	touches: ["owed.owedToYou", "balance.withPerson"],
	scope: (input) => ({ personId: input.personId }),
	run: async ({ book }, input) => {
		book.balances[input.personId] =
			(book.balances[input.personId] ?? 0) - input.minor;
		return {
			value: { paid: input.minor },
			undo: {
				kind: "revert",
				mutation: "test.settle",
				rows: [{ table: "payment", id: "pay1" }],
			},
		};
	},
};

const START: Book = {
	balances: { martin: 14_427_500, lucia: 175_000 },
	cash: 90_000_000,
};

function setup(figures = registry, initial = START) {
	const database = fakeDatabase(initial);
	const runner = createPreviewRunner({
		figures,
		transaction: database.transaction,
		actor: { userId: "me" },
	});
	return { database, runner };
}

describe("preview", () => {
	it("lists what changes and what does not, and commits nothing", async () => {
		const { database, runner } = setup();

		const result = await runner.preview(settle, {
			personId: "martin",
			minor: 14_427_500,
		});

		expect(result).toEqual({
			value: { paid: 14_427_500 },
			changes: [
				{
					id: "owed.owedToYou",
					currency: "ARS",
					before: ars(14_602_500),
					after: ars(175_000),
					delta: ars(-14_427_500),
					figureAfter: [ars(175_000)],
				},
				{
					id: "balance.withPerson",
					currency: "ARS",
					before: ars(14_427_500),
					after: ars(0),
					delta: ars(-14_427_500),
					figureAfter: [ars(0)],
				},
			],
			unchanged: [{ id: "netWorth", value: [ars(90_000_000)] }],
			unavailable: [],
			// No figure in this book is a converted total.
			approx: [],
		});
		expect(database.book()).toEqual(START);
		expect(database.commits()).toBe(0);
	});

	it("shows a balance flipping sign when you are overpaid", async () => {
		const { runner } = setup();

		const { changes } = await runner.preview(settle, {
			personId: "lucia",
			minor: 475_000,
		});

		expect(changes.find((c) => c.id === "balance.withPerson")).toEqual({
			id: "balance.withPerson",
			currency: "ARS",
			before: ars(175_000),
			after: ars(-300_000),
			delta: ars(-475_000),
			figureAfter: [ars(-300_000)],
		});
	});

	it("passes the mutation's own error through and commits nothing", async () => {
		const { database, runner } = setup();
		const refusal = new Error("amount must be positive");
		const failing: MoneyMutation<SettleInput, never, FakeTx> = {
			...settle,
			run: async ({ book }) => {
				book.cash = 0;
				throw refusal;
			},
		};

		await expect(
			runner.preview(failing, { personId: "martin", minor: -1 }),
		).rejects.toBe(refusal);
		expect(database.book()).toEqual(START);
	});

	it("fails if the transaction runner swallows the rollback", async () => {
		const swallowing: TransactionRunner<FakeTx> = async <T>(
			work: (tx: FakeTx) => Promise<T>,
		) => {
			await work({ book: structuredClone(START) }).catch(() => undefined);
			return undefined as T;
		};
		const runner = createPreviewRunner({
			figures: registry,
			transaction: swallowing,
			actor: { userId: "me" },
		});

		await expect(
			runner.preview(settle, { personId: "martin", minor: 1 }),
		).rejects.toThrow("finished without rolling back");
	});

	it("never lets the input's scope replace the actor's user", async () => {
		const seen = vi.fn(async () => ars(0));
		const figures = createFiguresRegistry([
			{ id: "spent", scope: ["personId"], compute: seen },
		]);
		const { runner } = setup(figures);
		const sneaky = {
			...settle,
			touches: ["spent"],
			scope: () => ({ userId: "someone-else", personId: "martin" }),
		};

		await runner.preview(sneaky, { personId: "martin", minor: 1 });

		expect(seen).toHaveBeenCalledWith(
			expect.anything(),
			{ userId: "me", personId: "martin" },
			expect.anything(),
		);
	});
});

describe("apply", () => {
	it("commits and reports the same diff the preview showed", async () => {
		const input = { personId: "martin", minor: 10_000_000 };
		const { database, runner } = setup();

		const previewed = await runner.preview(settle, input);
		const applied = await runner.apply(settle, input);

		const { undo, ...appliedDiff } = applied;
		expect(appliedDiff).toEqual(previewed);
		expect(undo).toEqual({
			kind: "revert",
			mutation: "test.settle",
			rows: [{ table: "payment", id: "pay1" }],
		});
		expect(database.purposes).toEqual(["preview", "apply"]);
		expect(database.book().balances.martin).toBe(4_427_500);
		expect(database.commits()).toBe(1);
	});
});

describe("figure failures", () => {
	it("fails before opening a transaction when a touched figure is not registered", async () => {
		const transaction = vi.fn();
		const runner = createPreviewRunner({
			figures: registry,
			transaction,
			actor: { userId: "me" },
		});
		const undeclared = { ...settle, touches: ["owed.youOwe"] };
		const input = { personId: "martin", minor: 1 };

		await expect(runner.preview(undeclared, input)).rejects.toThrow(
			FigureRegistryError,
		);
		await expect(runner.apply(undeclared, input)).rejects.toThrow(
			FigureRegistryError,
		);
		expect(transaction).not.toHaveBeenCalled();
	});

	it("aborts preview and apply when a figure throws, writing nothing", async () => {
		let calls = 0;
		const flaky: FigureDefinition<FakeTx> = {
			...netWorth,
			// Fails on the read after the mutation, so the write has already happened inside the transaction.
			compute: async ({ book }) => {
				calls += 1;
				if (calls % 2 === 0) throw new Error("rate service down");
				return ars(book.cash);
			},
		};
		const { database, runner } = setup(
			createFiguresRegistry([owedToYou, withPerson, flaky]),
		);
		const input = { personId: "martin", minor: 1 };

		await expect(runner.preview(settle, input)).rejects.toThrow(FigureError);
		await expect(runner.apply(settle, input)).rejects.toMatchObject({
			figureId: "netWorth",
		});
		expect(database.book()).toEqual(START);
		expect(database.commits()).toBe(0);
	});
});
