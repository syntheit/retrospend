/**
 * The overlay replays account and transfer entries: the rows an entry
 * booked over the store, in order, all or none. Home ARS in Buenos Aires,
 * blue 1,545. The USD account "a" holds 1,000 and is updated to 1,200 and
 * then 1,500; the ARS transfer vectors' accounts hold 5,000,000 and 100,000.
 * An acked entry's answered version is the account's version, whatever the
 * device counted, and an entry stacked on it still replays.
 */
import { describe, expect, it } from "vitest";
import { seededAccountStore } from "../account-conformance";
import { uuid } from "../account-vectors";
import { BA, rate, seed } from "../expense-create-vectors";
import type { MemoryStore } from "../memory-store";
import { seededTransferStore } from "../transfer-conformance";
import {
	ARS_HOME,
	ARS1,
	ARS2,
	accounts,
	create,
} from "../transfer-vectors-kit";
import { type BookedWrite, bookIn, type WriteOp } from "./book";
import { type PendingEntry, readOverlaid } from "./pending";

const NOW = Date.parse("2026-11-10T15:00:00.000Z");
const A = uuid(1);

function openAccount() {
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

const balanceTo = (balance: string, n: number): WriteOp => ({
	kind: "accountBalance",
	body: { id: A, balance, legId: uuid(10 + n), rateTypeId: uuid(20 + n) },
});

/** Books `op` over `entries` (nothing is kept) and wraps it as the phone's list holds it. */
async function entryOver(
	store: MemoryStore,
	entries: PendingEntry[],
	clientId: string,
	op: WriteOp,
	over: Partial<PendingEntry> = {},
): Promise<{ entry: PendingEntry; booked: BookedWrite }> {
	const booked = await readOverlaid(store, entries, 0, (tx) =>
		bookIn(tx, op, {}, NOW),
	);
	return {
		booked,
		entry: {
			clientId,
			bookedAt: NOW,
			changes: booked.changes,
			changed: booked.changed,
			parked: false,
			...over,
		},
	};
}

const account = (store: MemoryStore, entries: PendingEntry[], settled = 0) =>
	readOverlaid(store, entries, settled, (tx) => ({
		row: tx.get("accounts", A),
		legs: tx.list("legs").filter((l) => l.accountId === A),
	}));

describe("the overlay replays an account entry", () => {
	it("lays the booked rows over the store and keeps the stored name", async () => {
		const store = await openAccount();
		const { entry } = await entryOver(store, [], "e1", balanceTo("1200", 1));
		const seen = await account(store, [entry]);
		expect(seen.row?.balance).toBe("1200");
		expect(seen.row?.name).toBe("Wise");
		expect(seen.legs.map((l) => l.id)).toEqual([uuid(11)]);
		// The store itself is as it was.
		expect(store.get("accounts", A)?.balance).toBe("1000");
	});

	it("replays two writes to one account in order, the second booked over the first", async () => {
		const store = await openAccount();
		const one = await entryOver(store, [], "e1", balanceTo("1200", 1));
		const two = await entryOver(store, [one.entry], "e2", balanceTo("1500", 2));
		expect(two.booked.accountBase?.balance).toBe("1200");
		const seen = await account(store, [one.entry, two.entry]);
		expect(seen.row?.balance).toBe("1500");
		expect(seen.legs.map((l) => l.id).sort()).toEqual([uuid(11), uuid(12)]);
	});

	it("leaves an entry out whole when a pull moved the account under it", async () => {
		const store = await openAccount();
		const { entry } = await entryOver(store, [], "e1", balanceTo("1200", 1));
		const row = store.get("accounts", A);
		if (!row) throw new Error("no account");
		await store.transaction((tx) =>
			tx.put("accounts", { ...row, balance: "1100" }),
		);
		const seen = await account(store, [entry]);
		expect(seen.row?.balance).toBe("1100");
		expect(seen.legs).toEqual([]);
	});

	it("holds a decimal by value: a pull that writes 1000.00000000 for 1000 is the same account", async () => {
		const store = await openAccount();
		const { entry } = await entryOver(store, [], "e1", balanceTo("1200", 1));
		const row = store.get("accounts", A);
		if (!row) throw new Error("no account");
		await store.transaction((tx) =>
			tx.put("accounts", { ...row, balance: "1000.00000000" }),
		);
		expect((await account(store, [entry])).row?.balance).toBe("1200");
	});

	it("never replays a parked entry", async () => {
		const store = await openAccount();
		const { entry } = await entryOver(store, [], "e1", balanceTo("1200", 1), {
			parked: true,
		});
		expect((await account(store, [entry])).row?.balance).toBe("1000");
	});

	it("takes the account's version from the ack, not from the device's count", async () => {
		const store = await openAccount();
		// The device's own count after a balance update is a placeholder (here 0 -> 1 at most).
		const { entry, booked } = await entryOver(
			store,
			[],
			"e1",
			balanceTo("1200", 1),
		);
		const placeholder = (
			booked.changes.find((c) => c.table === "accounts")?.after as
				| { version: number }
				| undefined
		)?.version;
		expect(placeholder).not.toBe(7);
		const acked = { ...entry, ack: { version: "7", pull: 1 } };
		const seen = await account(store, [acked], 0);
		expect(seen.row?.version).toBe(7);
		// A write booked over it is based on the answered version, and still replays.
		const next = await entryOver(store, [acked], "e2", balanceTo("1500", 2));
		expect(next.booked.accountBase).toEqual({ version: 7, balance: "1200" });
		expect((await account(store, [acked, next.entry], 0)).row?.balance).toBe(
			"1500",
		);
	});

	it("stops replaying an acked entry once a pull that began after the ack finished", async () => {
		const store = await openAccount();
		const { entry } = await entryOver(store, [], "e1", balanceTo("1200", 1));
		const acked = { ...entry, ack: { version: "7", pull: 1 } };
		expect((await account(store, [acked], 1)).row?.balance).toBe("1200");
		expect((await account(store, [acked], 2)).row?.balance).toBe("1000");
	});
});

describe("the overlay replays a transfer over a pending account write", () => {
	it("an update acked after the transfer was booked over it does not hold the transfer up: the version differs from the placeholder", async () => {
		const store = await seededTransferStore({
			name: "kit",
			seed: ARS_HOME,
			accounts: [accounts.ars1, accounts.ars2],
			budget: { currency: "ARS" },
			steps: [],
		});
		const update = await entryOver(store, [], "e1", {
			kind: "accountBalance",
			body: {
				id: ARS1,
				balance: "5001000",
				legId: uuid(31),
				rateTypeId: uuid(32),
			},
		});
		// Booked over the unsent update: the account row it holds has the device's placeholder version.
		const move = await entryOver(store, [update.entry], "e2", {
			...create(1, {
				fromAccountId: ARS1,
				toAccountId: ARS2,
				fromAmount: "1000",
				fee: { amount: "10" },
			}),
		});
		// The update is acked afterwards: the server named version 3, not the placeholder.
		const acked = { ...update.entry, ack: { version: "3", pull: 1 } };
		const seen = await readOverlaid(store, [acked, move.entry], 0, (tx) => ({
			from: tx.get("accounts", ARS1),
			to: tx.get("accounts", ARS2),
			transfers: tx.list("transfers").length,
		}));
		// 5,001,000 - 1,000 - the fee 10; the other account takes 1,000.
		expect(seen.from?.balance).toBe("4999990");
		expect(seen.from?.version).toBe(3);
		expect(seen.to?.balance).toBe("101000");
		expect(seen.transfers).toBe(1);
	});
});
