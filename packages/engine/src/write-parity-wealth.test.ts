/**
 * An acked account entry held to the rows a pull brought, by the columns the
 * conformance suites hold equal. Home ARS in Buenos Aires, blue 1,545. The USD
 * account "a" goes from 1,000 to 1,200: a Not logged leg of +200 (home ARS
 * 309,000 = 200 x 1,545) and the account's new balance. The server's answer
 * names the account's version, which the device never counts itself.
 */
import { describe, expect, it } from "vitest";
import { seededAccountStore } from "./account-conformance";
import { uuid } from "./account-vectors";
import { bookIn } from "./device/book";
import { type PendingChange, readOverlaid } from "./device/pending";
import { BA, rate, seed } from "./expense-create-vectors";
import type { MemoryStore } from "./memory-store";
import { compareEntry, type WriteVerdict } from "./write-parity";

const NOW = Date.parse("2026-11-10T15:00:00.000Z");
const A = uuid(1);
const LEG = uuid(11);

async function pulledAfterBalanceUpdate() {
	const store = await seededAccountStore({
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
	const booked = await readOverlaid(store, [], 0, (tx) =>
		bookIn(
			tx,
			{
				kind: "accountBalance",
				body: { id: A, balance: "1200", legId: LEG, rateTypeId: uuid(21) },
			},
			{},
			NOW,
		),
	);
	// The pull brings the server's rows: here the same ones, the server's version on the account.
	await store.transaction((tx) => {
		for (const c of booked.changes) {
			if (!c.after) continue;
			if (c.table === "accounts") {
				const stored = tx.get("accounts", c.id);
				if (stored) tx.put("accounts", { ...stored, ...c.after, version: 4 });
			} else tx.put(c.table, c.after as never);
		}
	});
	return { store, changes: booked.changes };
}

const compare = (
	store: MemoryStore,
	changes: readonly PendingChange[],
	version: string | null = "4",
) => compareEntry(store, changes, { bookedAt: NOW, version });

const outcome = (verdicts: WriteVerdict[], id: string) =>
	verdicts.find((v) => v.id === id);

describe("compareEntry of an account entry", () => {
	it("matches the rows the pull brought, and holds no snapshot to an id", async () => {
		const { store, changes } = await pulledAfterBalanceUpdate();
		const verdicts = compare(store, changes);
		expect(verdicts.map((v) => v.outcome)).toEqual(["match", "match"]);
		expect(verdicts.map((v) => v.id).sort()).toEqual([A, LEG].sort());
	});

	it("is not a difference when the server answered another version than the pulled account: another write came after", async () => {
		const { store, changes } = await pulledAfterBalanceUpdate();
		const verdicts = compare(store, changes, "3");
		expect(outcome(verdicts, A)).toEqual({
			id: A,
			outcome: "skipped",
			code: "changed_since",
		});
		expect(outcome(verdicts, LEG)?.outcome).toBe("match");
	});

	it("is a difference when the leg the server wrote has another amount", async () => {
		const { store, changes } = await pulledAfterBalanceUpdate();
		const leg = store.get("legs", LEG);
		if (!leg) throw new Error("no leg");
		await store.transaction((tx) => tx.put("legs", { ...leg, amount: "199" }));
		expect(outcome(compare(store, changes), LEG)).toEqual({
			id: LEG,
			outcome: "differs",
			fields: ["amount"],
		});
	});

	it("holds decimals by value: 200.00000000 is the leg's 200", async () => {
		const { store, changes } = await pulledAfterBalanceUpdate();
		const leg = store.get("legs", LEG);
		if (!leg) throw new Error("no leg");
		await store.transaction((tx) =>
			tx.put("legs", { ...leg, amount: "200.00000000" }),
		);
		expect(outcome(compare(store, changes), LEG)?.outcome).toBe("match");
	});

	it("leaves the account's balance to the legs: a later leg moving it is not a difference", async () => {
		const { store, changes } = await pulledAfterBalanceUpdate();
		const account = store.get("accounts", A);
		if (!account) throw new Error("no account");
		await store.transaction((tx) =>
			tx.put("accounts", { ...account, balance: "1250" }),
		);
		expect(outcome(compare(store, changes), A)?.outcome).toBe("match");
	});

	it("is a difference when a versioned column differs at the answered version", async () => {
		const { store, changes } = await pulledAfterBalanceUpdate();
		const account = store.get("accounts", A);
		if (!account) throw new Error("no account");
		await store.transaction((tx) =>
			tx.put("accounts", { ...account, exchangeRateType: "official" }),
		);
		expect(outcome(compare(store, changes), A)).toEqual({
			id: A,
			outcome: "differs",
			fields: ["exchangeRateType"],
		});
	});

	it("skips a leg the pull no longer has", async () => {
		const { store, changes } = await pulledAfterBalanceUpdate();
		await store.transaction((tx) => tx.delete("legs", LEG));
		expect(outcome(compare(store, changes), LEG)).toEqual({
			id: LEG,
			outcome: "skipped",
			code: "gone_already",
		});
	});
});
