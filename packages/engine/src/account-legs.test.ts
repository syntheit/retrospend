/**
 * The device's leg writer holds to the trigger's rules through the domain's
 * applyLegs: a liability moves the other way, a leg reaches only the snapshots
 * dated on or after it that were recorded after it, a balance update leg moves
 * no money, counted units follow the leg and never exceed the balance, and
 * Not tracked moves nothing. Every value is derived by hand.
 */
import { describe, expect, it } from "vitest";
import { seedRowOf } from "./account-conformance";
import { insertLegs } from "./account-legs";
import type { LegRow } from "./accounts";
import { NotFoundError } from "./errors";
import { MemoryStore } from "./memory-store";
import { repos } from "./repos";

const at = (iso: string) => new Date(iso);

const account = (
	id: string,
	over: Partial<ReturnType<typeof seedRowOf>> = {},
) => ({
	...seedRowOf({
		id,
		name: id,
		type: "CASH",
		currency: "ARS",
		balance: "1000.50",
		exchangeRate: "1050",
		exchangeRateType: "official",
	}),
	...over,
});

const leg = (id: string, over: Partial<LegRow> = {}): LegRow => ({
	id,
	accountId: "a1",
	currency: "ARS",
	date: at("2026-11-10T00:00:00Z"),
	createdAt: at("2026-11-10T15:00:00Z"),
	amount: "-250.25",
	source: "TRANSFER",
	homeAmount: null,
	homeCurrency: null,
	countedUnits: "0",
	transferId: null,
	expenseId: null,
	...over,
});

const snapshot = (
	id: string,
	day: string,
	balance: string,
	recorded: string,
) => ({
	id,
	accountId: "a1",
	date: at(`${day}T00:00:00Z`),
	recordedAt: at(recorded),
	balance,
	currency: "ARS",
	exchangeRateType: "official",
});

async function open(
	accounts = [account("a1")],
	snapshots: ReturnType<typeof snapshot>[] = [],
) {
	const store = new MemoryStore();
	await store.transaction((tx) => {
		for (const a of accounts) tx.put("accounts", a);
		for (const s of snapshots) tx.put("snapshots", s);
	});
	return store;
}

const insert = (store: MemoryStore, ...legs: LegRow[]) =>
	store.transaction((tx) => insertLegs(repos(tx).accounts, legs));

describe("insertLegs", () => {
	it("moves a balance by the leg: 1,000.50 less 250.25 is 750.25", async () => {
		const store = await open();
		await insert(store, leg("l1"));
		expect(store.get("accounts", "a1")?.balance).toBe("750.25");
		expect(store.get("legs", "l1")?.amount).toBe("-250.25");
	});

	it("moves a liability the other way: paying 250.25 into a card owing 1,000.50 leaves 750.25", async () => {
		const store = await open([
			account("a1", { type: "LIABILITY_CREDIT_CARD" }),
		]);
		await insert(store, leg("l1", { amount: "250.25" }));
		expect(store.get("accounts", "a1")?.balance).toBe("750.25");
	});

	it("applies several legs in order", async () => {
		const store = await open();
		await insert(
			store,
			leg("l1", { amount: "-100" }),
			leg("l2", { amount: "50.25" }),
		);
		expect(store.get("accounts", "a1")?.balance).toBe("950.75");
	});

	it("reaches the snapshots dated on or after the leg that were recorded after it, and no others", async () => {
		const store = await open(
			[account("a1")],
			[
				// Before the leg's day.
				snapshot("s9", "2026-11-09", "1000.50", "2026-11-09T20:00:00Z"),
				// The leg's day, recorded after the leg was made.
				snapshot("s10", "2026-11-10", "1000.50", "2026-11-10T16:00:00Z"),
				// A later day, recorded after.
				snapshot("s11", "2026-11-11", "1000.50", "2026-11-11T16:00:00Z"),
				// A later day recorded before the leg was made: it already holds it.
				snapshot("s12", "2026-11-12", "750.25", "2026-11-10T14:00:00Z"),
			],
		);
		await insert(store, leg("l1"));
		expect(store.list("snapshots").map((s) => [s.id, s.balance])).toEqual([
			["s10", "750.25"],
			["s11", "750.25"],
			["s12", "750.25"],
			["s9", "1000.50"],
		]);
	});

	it("moves no money for a balance update leg, whose account the checkpoint sets", async () => {
		const store = await open();
		await insert(store, leg("l1", { source: "BALANCE_UPDATE", amount: "999" }));
		expect(store.get("accounts", "a1")?.balance).toBe("1000.50");
		expect(store.get("legs", "l1")).toBeDefined();
	});

	it("counts the leg's units on the account and never above its balance", async () => {
		// 300 of the 1,000.50 are counted already; a leg of -100 that counts 100 more.
		const store = await open([account("a1", { countedUnits: "300" })]);
		await insert(store, leg("l1", { amount: "-100", countedUnits: "100" }));
		expect(store.get("accounts", "a1")).toMatchObject({
			balance: "900.5",
			countedUnits: "400",
		});
		// A leg that takes the balance below the counted units caps them: 400 of 50.
		await insert(store, leg("l2", { amount: "-850.50" }));
		expect(store.get("accounts", "a1")).toMatchObject({
			balance: "50",
			countedUnits: "50",
		});
	});

	it("counts nothing on a liability", async () => {
		const store = await open([
			account("a1", { type: "LIABILITY_LOAN", countedUnits: "0" }),
		]);
		await insert(store, leg("l1", { amount: "10", countedUnits: "10" }));
		expect(store.get("accounts", "a1")?.countedUnits).toBe("0");
	});

	it("keeps a Not tracked leg and moves nothing", async () => {
		const store = await open();
		await insert(store, leg("l1", { accountId: null }));
		expect(store.get("accounts", "a1")?.balance).toBe("1000.50");
		expect(store.get("legs", "l1")?.accountId).toBeNull();
	});

	it("names an account the store lacks and writes nothing", async () => {
		const store = await open();
		await expect(
			insert(store, leg("l1"), leg("l2", { accountId: "nope" })),
		).rejects.toThrow(NotFoundError);
		expect(store.list("legs")).toEqual([]);
		expect(store.get("accounts", "a1")?.balance).toBe("1000.50");
	});

	it("refuses a leg id that is taken and writes nothing", async () => {
		const store = await open();
		await insert(store, leg("l1"));
		await expect(insert(store, leg("l1", { amount: "5" }))).rejects.toThrow(
			"already exists",
		);
		expect(store.get("accounts", "a1")?.balance).toBe("750.25");
	});
});
