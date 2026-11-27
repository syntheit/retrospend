/**
 * The transfer writes' guards the vectors do not reach: a taken id is refused
 * and writes nothing (each of the five), a typed arrival no rate values is
 * not booked (never at 1), the note stays in the store and out of what a
 * booking keeps, and a delete runs only on a move the device holds whole: an
 * older pull's row, a missing leg or fee expense, a budget side and a budget
 * it cannot read each send it to the server, writing nothing. A delete gives
 * counted units back and takes them away never below zero. ARS home, blue
 * 1,545, official 1,050, saved zone Buenos Aires; every value is derived by
 * hand in the comment.
 */
import { MissingRateError } from "@retrospend/domain/money";
import { describe, expect, it } from "vitest";
import { BUDGET_GATE_ENTITIES } from "./budget-gate";
import { bookIn, isDeviceRefusal } from "./device/book";
import { fixtureRow } from "./fixtures";
import { LocalDb } from "./local-db";
import { dump } from "./local-fixtures";
import { InvalidInputError } from "./port";
import { seededTransferStore } from "./transfer-conformance";
import { createTransfer, TRANSFER_CREATE } from "./transfer-create-local";
import { deleteTransfer, TRANSFER_DELETE } from "./transfer-delete-local";
import { TransferOnlineError } from "./transfer-kit";
import type { TransferVector } from "./transfer-vector-types";
import {
	ARS_HOME,
	ARS1,
	ARS2,
	accounts,
	create,
	idsOf,
	NOV10,
	USD_COUNTED,
	USD_OUT,
	uuid,
} from "./transfer-vectors-kit";

const NOW = new Date(NOV10);
const t1 = idsOf(1);

async function open(
	accts: TransferVector["accounts"],
	budget: TransferVector["budget"] = { currency: "ARS" },
) {
	const store = await seededTransferStore({
		name: "kit",
		seed: ARS_HOME,
		accounts: accts,
		budget,
		steps: [],
	});
	return { store, db: new LocalDb(store) };
}

const body = (n = 1, over: Record<string, unknown> = {}) => ({
	...create(n, {
		fromAccountId: ARS1,
		toAccountId: ARS2,
		fromAmount: "1000",
		fee: { amount: "10" },
	}).body,
	...over,
});

const make = (input: ReturnType<typeof body>) =>
	createTransfer({ ...input, now: NOW });

describe("a taken id is refused and nothing is written", () => {
	it.each([
		["the transfer's", { id: uuid(901) }, { id: uuid(901) }],
		["the source leg's", { fromLegId: uuid(902) }, { fromLegId: uuid(902) }],
		["the destination leg's", { toLegId: uuid(903) }, { toLegId: uuid(903) }],
		["the fee leg's", { feeLegId: uuid(904) }, { feeLegId: uuid(904) }],
		[
			"the fee expense's",
			{ feeExpenseId: uuid(905) },
			{ feeExpenseId: uuid(905) },
		],
	])("%s", async (_name, first, again) => {
		const { db, store } = await open([accounts.ars1, accounts.ars2]);
		await db.write(TRANSFER_CREATE, make(body(1, first)));
		const before = dump(store);
		// A second move that reuses one id of the first.
		const error = await db
			.write(TRANSFER_CREATE, make(body(2, again)))
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(InvalidInputError);
		expect(dump(store)).toEqual(before);
	});
});

describe("a typed arrival no rate values is not booked", () => {
	it("ARS 25.75 for ZZZ 5 books no home value on the ZZZ leg: unbooked, never at 1", async () => {
		const { db, store } = await open([{ ...accounts.ars1, inBudget: false }]);
		const before = dump(store);
		const error = await db
			.write(
				TRANSFER_CREATE,
				make(
					body(1, {
						fromAccountId: ARS1,
						toAccountId: null,
						toCurrency: "ZZZ",
						fromAmount: "25.75",
						toAmount: "5",
						fee: null,
					}),
				),
			)
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(MissingRateError);
		expect((error as MissingRateError).currencies).toEqual(["ARS", "ZZZ"]);
		expect(dump(store)).toEqual(before);
	});

	it("a fee in a currency no rate values is not booked either", async () => {
		const { db, store } = await open([
			accounts.ars1,
			accounts.ars2,
			{ ...accounts.zzz, id: uuid(150) },
		]);
		const before = dump(store);
		const error = await db
			.write(
				TRANSFER_CREATE,
				make(body(1, { fee: { amount: "3", accountId: uuid(150) } })),
			)
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(MissingRateError);
		expect(dump(store)).toEqual(before);
	});
});

describe("the note is the person's text", () => {
	it("stays in the store and is not kept by a booking", async () => {
		const { store } = await open([accounts.ars1, accounts.ars2]);
		const op = {
			kind: "transferCreate",
			body: body(1, { note: "Rent split", fee: null }),
		} as const;
		const booked = await store.transaction((tx) =>
			bookIn(tx, op, {}, NOW.getTime()),
		);
		const kept = booked.changes.filter((w) => w.table === "transfers");
		expect(kept).toHaveLength(1);
		expect(JSON.stringify(kept)).not.toContain("Rent split");
		expect(kept[0]?.after).not.toHaveProperty("note");
	});

	it("a booking keeps the fee as an expense change without its title, and the rest as wealth rows", async () => {
		const { store } = await open([accounts.ars1, accounts.ars2]);
		const op = { kind: "transferCreate", body: body(1) } as const;
		const booked = await store.transaction((tx) =>
			bookIn(tx, op, {}, NOW.getTime()),
		);
		expect(
			booked.changes
				.filter((c) => c.table === "expenses")
				.map((c) => [c.table, c.id]),
		).toEqual([["expenses", t1.expense]]);
		expect(JSON.stringify(booked.changes)).not.toContain("Fee");
		expect(
			booked.changes
				.filter((c) => c.table !== "expenses")
				.map((w) => w.table)
				.sort(),
		).toEqual(["accounts", "accounts", "legs", "legs", "legs", "transfers"]);
	});

	it("a move the server books is a refusal the engine reads as 'the server decides'", async () => {
		const { store } = await open([accounts.ars1, accounts.usdOut]);
		const op = {
			kind: "transferCreate",
			body: body(1, { toAccountId: USD_OUT, fee: null, fromAmount: "1545000" }),
		} as const;
		const error = await store
			.transaction((tx) => bookIn(tx, op, {}, NOW.getTime()))
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(TransferOnlineError);
		expect(isDeviceRefusal(error)).toBe(true);
	});
});

/** A booked transfer in a store, ready to delete. */
async function booked(accts = [accounts.ars1, accounts.ars2], fee = true) {
	const kit = await open(accts);
	await kit.db.write(TRANSFER_CREATE, make(body(1, fee ? {} : { fee: null })));
	return kit;
}

const remove = (id = t1.transfer) => deleteTransfer({ id });

describe("a delete runs only on a move the device holds whole", () => {
	const refusesOnline = async (
		kit: Awaited<ReturnType<typeof booked>>,
		reason: string,
	) => {
		const before = dump(kit.store);
		const error = await kit.db
			.write(TRANSFER_DELETE, remove())
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(TransferOnlineError);
		expect((error as TransferOnlineError).reason).toBe(reason);
		expect(dump(kit.store)).toEqual(before);
	};

	it("deletes a whole one: legs, fee expense and balances go back", async () => {
		const kit = await booked();
		await kit.db.write(TRANSFER_DELETE, remove());
		expect(kit.store.list("legs")).toEqual([]);
		expect(kit.store.list("transfers")).toEqual([]);
		expect(kit.store.list("expenses")).toEqual([]);
		expect(kit.store.get("accounts", ARS1)?.balance).toBe("5000000");
	});

	it.each([
		["kind"],
		["fromAccountId"],
		["fromAmount"],
		["countedFromUnits"],
		["countedToUnits"],
		["note"],
	])(
		"a row an older pull wrote, with no %s, is the server's",
		async (column) => {
			const kit = await booked();
			await kit.store.transaction((tx) => {
				const row = { ...tx.get("transfers", t1.transfer) } as Record<
					string,
					unknown
				>;
				delete row[column];
				tx.put("transfers", row as never);
			});
			await refusesOnline(kit, "incomplete_transfer");
		},
	);

	it("a leg that has not been pulled is the server's", async () => {
		const kit = await booked();
		await kit.store.transaction((tx) => tx.delete("legs", t1.to));
		await refusesOnline(kit, "incomplete_transfer");
	});

	it("a fee expense that has not been pulled is the server's", async () => {
		const kit = await booked();
		await kit.store.transaction((tx) => tx.delete("expenses", t1.expense));
		await refusesOnline(kit, "incomplete_transfer");
	});

	it("an account that is not on the device is the server's", async () => {
		const kit = await booked();
		await kit.store.transaction((tx) => tx.delete("accounts", ARS2));
		await refusesOnline(kit, "incomplete_transfer");
	});

	it("a move with a budget side is the server's", async () => {
		const kit = await booked();
		await kit.store.transaction((tx) =>
			tx.put("wealthTransfers", {
				...fixtureRow("wealthTransfers", "w-1"),
				transferId: t1.transfer,
			}),
		);
		await refusesOnline(kit, "has_budget_side");
	});

	it("a budget the device cannot read is the server's: whether a side exists is unknown", async () => {
		const kit = await booked();
		await kit.store.transaction((tx) => tx.delete("budgetSnapshot", "budget"));
		await refusesOnline(kit, "budget_not_ready");
	});

	it("a transfer that is not there is not found, in the server's words", async () => {
		const { db } = await open([accounts.ars1]);
		await expect(db.write(TRANSFER_DELETE, remove(uuid(999)))).rejects.toThrow(
			"Transfer not found",
		);
	});
});

describe("counted units on a delete", () => {
	// USD 100 from the account with 300 counted units to one with none, both
	// outside the budget: 100 counted units go with the money (the source
	// 200, the destination 100). If the destination's counted units moved on
	// to 40 before the delete, taking 100 away stops at zero, not -60.
	it("takes the destination's away and stops at zero", async () => {
		const kit = await open([accounts.usdCounted, accounts.usdOut]);
		await kit.db.write(
			TRANSFER_CREATE,
			make(
				body(1, {
					fromAccountId: USD_COUNTED,
					toAccountId: USD_OUT,
					fromAmount: "100",
					fee: null,
				}),
			),
		);
		expect(kit.store.get("accounts", USD_OUT)?.countedUnits).toBe("100");
		await kit.store.transaction((tx) => {
			const row = tx.get("accounts", USD_OUT);
			if (row) tx.put("accounts", { ...row, countedUnits: "40" });
		});
		await kit.db.write(TRANSFER_DELETE, remove());
		expect(kit.store.get("accounts", USD_OUT)?.countedUnits).toBe("0");
		// The source got its 100 back: 200 + 100, under the 500 it holds.
		expect(kit.store.get("accounts", USD_COUNTED)?.countedUnits).toBe("300");
	});

	// Delete after the source gave up money: its counted units come back but
	// never above the balance it holds again. The source held 300 counted of
	// 500, moved 100 (counted 200, balance 400), then the balance was set to
	// 250 by hand: giving 100 back makes 300, capped at the balance 250 +
	// 100 (the leg reverses) = 350: 300 stays under it. With the balance at
	// 150 the cap is 150 + 100 = 250: 300 becomes 250.
	it("caps the source's counted units at what it holds once the money is back", async () => {
		const kit = await open([accounts.usdCounted, accounts.usdOut]);
		await kit.db.write(
			TRANSFER_CREATE,
			make(
				body(1, {
					fromAccountId: USD_COUNTED,
					toAccountId: USD_OUT,
					fromAmount: "100",
					fee: null,
				}),
			),
		);
		await kit.store.transaction((tx) => {
			const row = tx.get("accounts", USD_COUNTED);
			if (row) tx.put("accounts", { ...row, balance: "150" });
		});
		await kit.db.write(TRANSFER_DELETE, remove());
		expect(kit.store.get("accounts", USD_COUNTED)).toMatchObject({
			balance: "250",
			countedUnits: "250",
		});
	});
});

describe("a person with no budget books transfers on the device once the budget's entities are pulled", () => {
	const PULLED = Object.fromEntries(
		BUDGET_GATE_ENTITIES.map((entity) => [entity, "cursor"]),
	);
	const book = async (
		cursors: Record<string, string>,
		op: Parameters<typeof bookIn>[1],
	) => {
		const { store } = await open([accounts.ars1, accounts.ars2], "none");
		return store.transaction((tx) => bookIn(tx, op, cursors, NOW.getTime()));
	};
	const move = {
		kind: "transferCreate",
		body: body(1, { fee: null }),
	} as const;

	it("Just track with the pull finished: booked, nothing recorded for a budget that is not there", async () => {
		const booked = await book(PULLED, move);
		expect(booked.unbooked).toBeUndefined();
		expect(booked.changes.map((c) => c.table)).toContain("transfers");
	});

	it("with one entity not pulled yet: the server's, because a book may not have arrived", async () => {
		const error = await book({ ...PULLED, budgetBooks: "" }, move).catch(
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(TransferOnlineError);
		expect((error as TransferOnlineError).reason).toBe("budget_not_ready");
	});

	it("with an entity being pulled again after a reset: the server's", async () => {
		const error = await book({ ...PULLED, envelopes: "reset" }, move).catch(
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(TransferOnlineError);
	});

	it("with no cursors at all: the server's", async () => {
		const error = await book({}, move).catch((e: unknown) => e);
		expect((error as TransferOnlineError).reason).toBe("budget_not_ready");
	});

	it("a delete runs too, on a move the device holds whole", async () => {
		const { store, db } = await open([accounts.ars1, accounts.ars2], "none");
		await db.write(
			TRANSFER_CREATE,
			createTransfer({
				...body(1, { fee: null }),
				now: NOW,
				budgetPulled: true,
			}),
		);
		const strict = await store
			.transaction((tx) =>
				bookIn(
					tx,
					{ kind: "transferDelete", body: { id: t1.transfer } },
					{},
					NOW.getTime(),
				),
			)
			.catch((e: unknown) => e);
		expect(strict).toBeInstanceOf(TransferOnlineError);
		const booked = await store.transaction((tx) =>
			bookIn(
				tx,
				{ kind: "transferDelete", body: { id: t1.transfer } },
				PULLED,
				NOW.getTime(),
			),
		);
		expect(
			booked.changes.some((c) => c.table === "transfers" && c.after === null),
		).toBe(true);
	});
});
