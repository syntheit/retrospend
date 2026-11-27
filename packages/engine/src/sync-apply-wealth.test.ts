/**
 * The Wealth rows in the sync apply layer: every field the Wealth writes read
 * lands on the port row, text stays in the store and leaves it only through
 * the without-text functions, and a field of the wire that the mapper drops
 * fails here. Values are hand-picked to be told apart (a leg's counted units
 * differ from its account's), not derived: the mapper only carries them.
 */
import { describe, expect, it } from "vitest";
// The row schemas are not on the contract's device subpath (the engine ships
// without them); a test reads them from the source, as the key list's owner.
import { syncWealthTransferSchema } from "../../api-contract/src/sync/book-schemas";
import {
	syncAccountLegSchema,
	syncAccountSchema,
	syncTransferSchema,
} from "../../api-contract/src/sync/schemas";
import { MemoryStore } from "./memory-store";
import { applySyncPage, type WireAccount, type WireLeg } from "./sync-apply";
import type { WireTransfer, WireWealthTransfer } from "./sync-apply-book";
import {
	ACCOUNT_TEXT_COLUMNS,
	accountWithoutText,
	TRANSFER_TEXT_COLUMNS,
	transferWithoutText,
} from "./wealth-rows";

const none = { tombstones: [] };

// Whole wire rows, typed as the contract's DTOs: a field the contract adds
// fails to compile here, and the keys test below fails for the mapper.
const ACCOUNT: WireAccount = {
	id: "a-usd",
	name: "Savings in dollars",
	type: "CASH",
	currency: "USD",
	balance: "1000",
	exchangeRate: "1545",
	exchangeRateType: "blue",
	isLiquid: false,
	interestRate: null,
	minimumPayment: null,
	dueDate: null,
	inBudget: true,
	countedUnits: "250.5",
	closedAt: null,
	iconKind: "MONOGRAM",
	iconValue: "S",
	version: 7,
	createdAt: "2026-01-01T03:00:00.000Z",
	updatedAt: "2026-10-05T15:00:01.250Z",
};

const LEG: WireLeg = {
	id: "l1",
	accountId: "a-usd",
	currency: "USD",
	amount: "1000",
	homeAmount: "1050000",
	homeCurrency: "ARS",
	date: "2026-10-01T00:00:00.000Z",
	source: "TRANSFER",
	transferId: "t1",
	expenseId: "x-fee",
	countedUnits: "100.25",
	createdAt: "2026-10-01T08:00:00.000Z",
};

const TRANSFER: WireTransfer = {
	id: "t1",
	kind: "EXCHANGE",
	date: "2026-10-01T00:00:00.000Z",
	fromAccountId: "a-ars",
	fromAmount: "1545000",
	fromCurrency: "ARS",
	toAccountId: "a-usd",
	toAmount: "1000",
	toCurrency: "USD",
	referenceRateType: "blue",
	feeExpenseId: "x-fee",
	countedFromUnits: "12.5",
	countedToUnits: "3.75",
	note: "Dollars for the trip",
	createdAt: "2026-10-01T08:00:00.000Z",
};

const WEALTH: WireWealthTransfer = {
	id: "wt1",
	bookId: "book-1",
	direction: "TO_WEALTH",
	envelopeId: "env-1",
	transferId: "t1",
	sourceExpenseId: null,
	assetAccountId: "a-usd",
	countOnly: false,
	date: "2026-10-01T00:00:00.000Z",
	amount: "5000",
	note: null,
	createdAt: "2026-10-01T08:00:00.000Z",
};

async function applied() {
	const store = new MemoryStore();
	await store.transaction((tx) => {
		applySyncPage(tx, "accounts", { items: [ACCOUNT], ...none });
		applySyncPage(tx, "legs", { items: [LEG], ...none });
		applySyncPage(tx, "transfers", { items: [TRANSFER], ...none });
		applySyncPage(tx, "wealthTransfers", { items: [WEALTH], ...none });
	});
	return store;
}

describe("the Wealth rows a pull makes", () => {
	it("an account keeps its name, budget flag, counted units, liquidity, icon kind and version", async () => {
		const row = (await applied()).get("accounts", "a-usd");
		expect(row).toMatchObject({
			name: "Savings in dollars",
			inBudget: true,
			countedUnits: "250.5",
			isLiquid: false,
			iconKind: "MONOGRAM",
			version: 7,
		});
	});

	it("a null budget flag and a null icon kind stay null, not false or a default", async () => {
		const store = new MemoryStore();
		await store.transaction((tx) =>
			applySyncPage(tx, "accounts", {
				items: [{ ...ACCOUNT, inBudget: null, iconKind: null, isLiquid: true }],
				...none,
			}),
		);
		expect(store.get("accounts", "a-usd")).toMatchObject({
			inBudget: null,
			iconKind: null,
			isLiquid: true,
		});
	});

	it("a leg keeps its counted units, transfer and expense, and a Not tracked leg keeps nulls", async () => {
		const store = await applied();
		expect(store.get("legs", "l1")).toMatchObject({
			countedUnits: "100.25",
			transferId: "t1",
			expenseId: "x-fee",
		});
		await store.transaction((tx) =>
			applySyncPage(tx, "legs", {
				items: [
					{
						...LEG,
						id: "l2",
						accountId: null,
						transferId: null,
						expenseId: null,
						countedUnits: "0",
					},
				],
				...none,
			}),
		);
		expect(store.get("legs", "l2")).toMatchObject({
			accountId: null,
			countedUnits: "0",
			transferId: null,
			expenseId: null,
		});
	});

	it("a transfer keeps its source, kind, counted units and note", async () => {
		const row = (await applied()).get("transfers", "t1");
		expect(row).toMatchObject({
			kind: "EXCHANGE",
			fromAccountId: "a-ars",
			fromAmount: "1545000",
			countedFromUnits: "12.5",
			countedToUnits: "3.75",
			note: "Dollars for the trip",
		});
	});

	it("a transfer out of Not tracked keeps a null source and a null note", async () => {
		const store = new MemoryStore();
		await store.transaction((tx) =>
			applySyncPage(tx, "transfers", {
				items: [{ ...TRANSFER, fromAccountId: null, note: null }],
				...none,
			}),
		);
		expect(store.get("transfers", "t1")).toMatchObject({
			fromAccountId: null,
			note: null,
		});
	});

	it("a Wealth move keeps the transfer that made it, or null", async () => {
		const store = await applied();
		expect(store.get("wealthTransfers", "wt1")?.transferId).toBe("t1");
		await store.transaction((tx) =>
			applySyncPage(tx, "wealthTransfers", {
				items: [{ ...WEALTH, id: "wt2", transferId: null }],
				...none,
			}),
		);
		expect(store.get("wealthTransfers", "wt2")?.transferId).toBeNull();
	});

	it("refuses a counted units value that is not a decimal and writes nothing of the page", async () => {
		const store = new MemoryStore();
		for (const [entity, items] of [
			["accounts", [ACCOUNT, { ...ACCOUNT, id: "a2", countedUnits: "1e3" }]],
			["legs", [LEG, { ...LEG, id: "l2", countedUnits: "" }]],
			[
				"transfers",
				[TRANSFER, { ...TRANSFER, id: "t2", countedFromUnits: "x" }],
			],
			[
				"transfers",
				[TRANSFER, { ...TRANSFER, id: "t2", countedToUnits: "1,5" }],
			],
			["transfers", [TRANSFER, { ...TRANSFER, id: "t2", fromAmount: "NaN" }]],
		] as const)
			await expect(
				store.transaction((tx) =>
					applySyncPage(tx, entity, { items: items as never, ...none }),
				),
			).rejects.toThrow("is not a decimal");
		expect(store.list("accounts")).toEqual([]);
		expect(store.list("legs")).toEqual([]);
		expect(store.list("transfers")).toEqual([]);
	});
});

describe("text on the Wealth rows", () => {
	it("the store keeps the name and the note as the server sent them", async () => {
		const store = await applied();
		expect(store.get("accounts", "a-usd")?.name).toBe("Savings in dollars");
		expect(store.get("transfers", "t1")?.note).toBe("Dollars for the trip");
	});

	it("without-text drops exactly the text columns and nothing else", async () => {
		const store = await applied();
		const account = store.get("accounts", "a-usd");
		const transfer = store.get("transfers", "t1");
		if (!account || !transfer) throw new Error("rows missing");
		const bareAccount = accountWithoutText(account) as Record<string, unknown>;
		const bareTransfer = transferWithoutText(transfer) as Record<
			string,
			unknown
		>;
		for (const c of ACCOUNT_TEXT_COLUMNS)
			expect(bareAccount).not.toHaveProperty(c);
		for (const c of TRANSFER_TEXT_COLUMNS)
			expect(bareTransfer).not.toHaveProperty(c);
		expect(JSON.stringify(bareAccount)).not.toContain("Savings");
		expect(JSON.stringify(bareTransfer)).not.toContain("trip");
		expect(Object.keys(bareAccount).length).toBe(
			Object.keys(account).length - ACCOUNT_TEXT_COLUMNS.length,
		);
		expect(Object.keys(bareTransfer).length).toBe(
			Object.keys(transfer).length - TRANSFER_TEXT_COLUMNS.length,
		);
	});
});

// The wire fields no Wealth write reads, each with the reason it is not on the
// row. Every other field of the wire must be on the row the mapper makes: a
// field missing from the mapper (or from this list) fails.
const NOT_KEPT = {
	accounts: {
		iconValue: "icon changes are online for good (an upload, no v1 route)",
		updatedAt: "the 'Updated' date of the screen, never a guard (version is)",
	},
	legs: {},
	transfers: {
		fromCurrency: "the source leg carries the currency a reverse needs",
		referenceRateType: "read from the transfer by the server only",
		createdAt: "never read",
	},
	wealthTransfers: {
		sourceExpenseId: "income moves are online until M7",
		assetAccountId: "the account is on the transfer",
		countOnly: "the budget's own flag, not a Wealth write input",
		note: "instance class text, never read on a device",
		createdAt: "never read",
	},
} as const;

describe("the wire fields the mapper must carry", () => {
	const cases = [
		["accounts", syncAccountSchema, ACCOUNT],
		["legs", syncAccountLegSchema, LEG],
		["transfers", syncTransferSchema, TRANSFER],
		["wealthTransfers", syncWealthTransferSchema, WEALTH],
	] as const;

	for (const [entity, schema, wire] of cases)
		it(`${entity}: every wire field is on the row or named as not kept`, async () => {
			const store = new MemoryStore();
			await store.transaction((tx) =>
				applySyncPage(tx, entity, { items: [wire as never], ...none }),
			);
			const row = store.get(entity, wire.id) as unknown as Record<
				string,
				unknown
			>;
			const notKept = Object.keys(NOT_KEPT[entity]);
			const fields = Object.keys(schema.shape);
			for (const field of fields) {
				if (notKept.includes(field))
					expect(row, `${field} is listed as not kept`).not.toHaveProperty(
						field,
					);
				else expect(row, `${field} was dropped`).toHaveProperty(field);
			}
			for (const field of notKept)
				expect(fields, `${field} is not on the wire`).toContain(field);
		});
});
