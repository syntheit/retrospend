import { describe, expect, it } from "vitest";
import { seededAccountStore } from "../account-conformance";
import { uuid } from "../account-vectors";
import { BA, rate, seed } from "../expense-create-vectors";
import { InvalidInputError } from "../port";
import { repos } from "../repos";
import { bookIn, isDeviceRefusal, planOf, type WriteOp } from "./book";
import { readOverlaid } from "./pending";

// An account write booked on the device. Home ARS in Buenos Aires, blue 1,545.
// Booking a balance update of the USD account "a" from 1,000 to 1,200 at blue
// changes the account (1,200), adds the Not logged leg (+200, 309,000 ARS) and
// replaces the day's snapshot. The rows are `changes` like any write's, an
// account's name is never kept in them, and `accountBase` is the version and
// stored balance the send names as expectedVersion and expectedBalance.
const NOW = Date.parse("2026-11-10T15:00:00.000Z");
const A = uuid(1);

async function open() {
	return seededAccountStore({
		name: "kit",
		seed: seed("ARS", BA, [
			rate("ARS", "blue", "1545", "2026-11-01T00:00:00Z"),
		]),
		accounts: [
			{
				id: A,
				name: "Wise",
				type: "CASH",
				currency: "USD",
				balance: "1000",
				exchangeRate: "1",
				exchangeRateType: "blue",
			},
		],
		steps: [],
	});
}

const book = async (op: WriteOp) => {
	const store = await open();
	return store.transaction((tx) => bookIn(tx, op, {}, NOW));
};

const balance: WriteOp = {
	kind: "accountBalance",
	body: { id: A, balance: "1200", legId: uuid(2), rateTypeId: uuid(3) },
};

describe("bookIn of an account write", () => {
	it("keeps the account-family rows as the changes of the entry, in the order they changed", async () => {
		const booked = await book(balance);
		expect(booked.unbooked).toBeUndefined();
		expect(booked.changes.map((c) => [c.table, c.id])).toEqual([
			["legs", uuid(2)],
			["snapshots", `${A}:2026-11-10`],
			["accounts", A],
		]);
	});

	it("never keeps the account's name", async () => {
		const booked = await book(balance);
		const account = booked.changes.find((c) => c.table === "accounts");
		expect(account?.before).not.toHaveProperty("name");
		expect(account?.after).not.toHaveProperty("name");
		expect(account?.after).toMatchObject({ balance: "1200" });
	});

	it("names the version and balance the send is based on", async () => {
		const booked = await book(balance);
		expect(booked.accountBase).toEqual({ version: 0, balance: "1000" });
		expect(booked.base).toBeNull();
	});

	it("has no base for a create", async () => {
		const booked = await book({
			kind: "accountCreate",
			body: {
				id: uuid(9),
				name: "Cash",
				type: "CASH",
				currency: "ARS",
				balance: "5",
				rateType: "blue",
				isLiquid: true,
			},
		});
		expect(booked.accountBase).toBeUndefined();
		const account = booked.changes.find((c) => c.table === "accounts");
		expect(account).toMatchObject({ before: null, id: uuid(9) });
	});

	it("is unbooked, not refused, when there is no rate", async () => {
		const booked = await book({
			kind: "accountCreate",
			body: {
				id: uuid(9),
				name: "Nubank",
				type: "CASH",
				currency: "BRL",
				balance: "5",
				isLiquid: true,
			},
		});
		expect(booked).toMatchObject({ changes: [], unbooked: "no_rate" });
	});

	it("refuses an account that is not there, as a refusal the server decides", async () => {
		const error = await book({
			kind: "accountClose",
			body: { id: uuid(7) },
		}).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(Error);
		expect(isDeviceRefusal(error)).toBe(true);
		expect(error).not.toBeInstanceOf(TypeError);
	});

	it("keeps nothing in the store when read over the overlay's discarded transaction", async () => {
		const store = await open();
		const booked = await readOverlaid(store, [], 0, (tx) =>
			bookIn(tx, balance, {}, NOW),
		);
		expect(booked.changes).toHaveLength(3);
		expect(store.get("accounts", A)?.balance).toBe("1000");
		expect(store.list("legs")).toEqual([]);
	});
});

describe("planOf an account write", () => {
	it("names the server's mutation and the figures it moves", async () => {
		const store = await open();
		const plan = planOf(balance, store.snapshot(), {}, new Date(NOW));
		expect(plan.id).toBe("account.updateBalance");
		expect(plan.touches).toEqual([
			"netWorth",
			"accounts.balance",
			"netWorthChange.notLogged",
			"netWorthChange.revaluation",
		]);
	});

	it("is an InvalidInputError for what the write refuses", async () => {
		const store = await open();
		const plan = planOf(
			{
				kind: "accountBalance",
				body: { ...balance.body, balance: "1.234" },
			} as WriteOp,
			store.snapshot(),
			{},
			new Date(NOW),
		);
		await expect(
			store.transaction((tx) => plan.write(repos(tx))),
		).rejects.toThrow(InvalidInputError);
	});
});
