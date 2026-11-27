/**
 * The account writes' guards that the vectors do not reach: a taken id is
 * refused and writes nothing, a typed custom rate is used as typed and moves
 * the version, a request for a type with no rate today falls back to the best
 * one (and records that, not the request), a switch dated before a later one
 * chains it, an update that changes nothing writes only the day's snapshot, an
 * explicit zone wins over the saved one. ARS home, blue 1,545, official 1,050,
 * saved zone Buenos Aires; every value is derived by hand in the comment.
 */
import { MissingRateError } from "@retrospend/domain/money";
import { describe, expect, it } from "vitest";
import { ACCOUNT_UPDATE_BALANCE, updateBalance } from "./account-balance-local";
import { seededAccountStore } from "./account-conformance";
import { ACCOUNT_SET_RATE_TYPE, setRateType } from "./account-rate-local";
import { ACCOUNT_CLOSE, closeAccount } from "./account-state-local";
import { uuid } from "./account-vectors";
import {
	ACCOUNT_CREATE,
	ACCOUNT_UPDATE,
	type AccountFieldsInput,
	createAccount,
	updateAccount,
} from "./account-write-local";
import { NotFoundError } from "./errors";
import { BA, rate, seed } from "./expense-create-vectors";
import { LocalDb } from "./local-db";
import { InvalidInputError } from "./port";

const RATES = [
	rate("ARS", "blue", "1545", "2026-11-01T00:00:00Z"),
	rate("ARS", "official", "1050", "2026-11-01T00:00:00Z"),
];
const NOW = new Date("2026-11-10T15:00:00Z");
const LATER = new Date("2026-11-10T16:00:00Z");

async function open() {
	const store = await seededAccountStore({
		name: "kit",
		seed: seed("ARS", BA, RATES),
		steps: [],
	});
	return { store, db: new LocalDb(store) };
}

const wise: AccountFieldsInput & { id: string } = {
	id: uuid(1),
	name: "Wise",
	type: "CASH",
	currency: "USD",
	balance: "1000",
	rateType: "blue",
	isLiquid: true,
};

const created = async () => {
	const kit = await open();
	await kit.db.write(ACCOUNT_CREATE, createAccount({ ...wise, now: NOW }));
	return kit;
};

describe("a taken id is refused and nothing is written", () => {
	it("the account's", async () => {
		const { db, store } = await created();
		const before = store.list("accounts");
		await expect(
			db.write(
				ACCOUNT_CREATE,
				createAccount({ ...wise, balance: "5", now: LATER }),
			),
		).rejects.toThrow(InvalidInputError);
		expect(store.list("accounts")).toEqual(before);
	});

	it("the Not logged leg's", async () => {
		const { db, store } = await created();
		const body = { accountId: wise.id, legId: uuid(2), rateTypeId: uuid(3) };
		await db.write(
			ACCOUNT_UPDATE_BALANCE,
			updateBalance({ ...body, balance: "1100", now: NOW }),
		);
		const before = [
			store.list("accounts"),
			store.list("legs"),
			store.list("snapshots"),
		];
		await expect(
			db.write(
				ACCOUNT_UPDATE_BALANCE,
				updateBalance({ ...body, balance: "1200", now: LATER }),
			),
		).rejects.toThrow(InvalidInputError);
		expect([
			store.list("accounts"),
			store.list("legs"),
			store.list("snapshots"),
		]).toEqual(before);
	});

	it("the rate switch's", async () => {
		const { db, store } = await created();
		const body = { accountId: wise.id, rateTypeId: uuid(3) };
		await db.write(
			ACCOUNT_SET_RATE_TYPE,
			setRateType({ ...body, rateType: "official", now: NOW }),
		);
		const before = [store.list("accounts"), store.list("rateSwitches")];
		await expect(
			db.write(
				ACCOUNT_SET_RATE_TYPE,
				setRateType({ ...body, rateType: "blue", now: LATER }),
			),
		).rejects.toThrow(InvalidInputError);
		expect([store.list("accounts"), store.list("rateSwitches")]).toEqual(
			before,
		);
	});
});

describe("rates", () => {
	// A BRL account at a typed rate: 1 USD = 5.5 BRL, used as typed whatever the
	// table says (it has no BRL). Changing the typed rate to 5.6 is an edit of
	// the account (version 1); the balance 100 -> 110 is a Not logged +10 booked
	// at the home rate of BRL: 10 / 5.6 USD x 1,545 = 2,759.8214... ARS, kept
	// to 8 decimals half to even: 2759.82142857.
	it("a typed custom rate is used as typed and moves the version when it changes", async () => {
		const { db, store } = await open();
		await db.write(
			ACCOUNT_CREATE,
			createAccount({
				id: uuid(1),
				name: "Nubank",
				type: "CASH",
				currency: "BRL",
				balance: "100",
				rateType: "custom",
				exchangeRate: "5.5",
				isLiquid: true,
				now: NOW,
			}),
		);
		expect(store.get("accounts", uuid(1))).toMatchObject({
			exchangeRate: "5.5",
			exchangeRateType: "custom",
			version: 0,
		});
		await db.write(
			ACCOUNT_UPDATE_BALANCE,
			updateBalance({
				accountId: uuid(1),
				balance: "110",
				rateType: "custom",
				exchangeRate: "5.6",
				legId: uuid(2),
				rateTypeId: uuid(3),
				now: LATER,
			}),
		);
		expect(store.get("accounts", uuid(1))).toMatchObject({
			balance: "110",
			exchangeRate: "5.6",
			version: 1,
		});
		expect(store.get("legs", uuid(2))?.amount).toBe("10");
		expect(store.list("rateSwitches")).toEqual([]);
	});

	// BRL has no rows and no typed rate: nothing to store the account with.
	it("a currency with no rate is a MissingRateError, never a rate of 1", async () => {
		const { db, store } = await open();
		await expect(
			db.write(
				ACCOUNT_CREATE,
				createAccount({
					...wise,
					id: uuid(9),
					currency: "BRL",
					rateType: null,
					now: NOW,
				}),
			),
		).rejects.toThrow(MissingRateError);
		expect(store.list("accounts")).toEqual([]);
	});

	// An ARS account at official asks for "mep", which has no row: the best rate
	// answers (blue, the ARS default), so the account moves to blue and the
	// switch records blue, never the request. A USD account has no rate of its
	// own, so its type is what was asked (a label that values the home side).
	it("a request for a type with no rate falls back and records the type it got", async () => {
		const { db, store } = await open();
		await db.write(
			ACCOUNT_CREATE,
			createAccount({
				id: uuid(1),
				name: "Cash",
				type: "CASH",
				currency: "ARS",
				balance: "100",
				rateType: "official",
				isLiquid: true,
				now: NOW,
			}),
		);
		await db.write(
			ACCOUNT_UPDATE_BALANCE,
			updateBalance({
				accountId: uuid(1),
				balance: "100",
				rateType: "mep",
				legId: uuid(2),
				rateTypeId: uuid(3),
				now: LATER,
			}),
		);
		expect(store.get("rateSwitches", uuid(3))).toMatchObject({
			type: "blue",
			previousType: "official",
		});
		expect(store.get("accounts", uuid(1))).toMatchObject({
			exchangeRateType: "blue",
			exchangeRate: "1545",
			version: 1,
		});
	});

	// A rate type switch dated Nov 5 after one dated Nov 10 (official after
	// blue): the new row is first in time, so it follows the account's first
	// type (blue); the Nov 10 row now follows it (previousType mep); the account
	// stays official, the later switch being in force. Version unchanged.
	it("a switch dated before a later one chains it and leaves the type in force", async () => {
		const { db, store } = await created();
		await db.write(
			ACCOUNT_SET_RATE_TYPE,
			setRateType({
				accountId: wise.id,
				rateType: "official",
				rateTypeId: uuid(2),
				now: NOW,
			}),
		);
		await db.write(
			ACCOUNT_SET_RATE_TYPE,
			setRateType({
				accountId: wise.id,
				rateType: "mep",
				from: "2026-11-05",
				rateTypeId: uuid(3),
				now: LATER,
			}),
		);
		expect(store.get("rateSwitches", uuid(3))).toMatchObject({
			type: "mep",
			previousType: "blue",
		});
		expect(store.get("rateSwitches", uuid(2))).toMatchObject({
			type: "official",
			previousType: "mep",
		});
		expect(store.get("accounts", wise.id)).toMatchObject({
			exchangeRateType: "official",
			version: 1,
		});
	});
});

describe("what an update that changes nothing writes", () => {
	// The balance is already 1,000 at blue: no leg, no switch, the account's
	// columns as they were (the version stays), and the day's snapshot is
	// recorded again at the later instant.
	it("is the day's snapshot", async () => {
		const { db, store } = await created();
		const before = store.get("accounts", wise.id);
		await db.write(
			ACCOUNT_UPDATE_BALANCE,
			updateBalance({
				accountId: wise.id,
				balance: "1000",
				legId: uuid(2),
				rateTypeId: uuid(3),
				now: LATER,
			}),
		);
		expect(store.get("accounts", wise.id)).toEqual(before);
		expect(store.list("legs")).toEqual([]);
		expect(store.list("snapshots").map((s) => s.recordedAt)).toEqual([LATER]);
	});
});

describe("the zone", () => {
	// 2026-11-10T02:00Z is Nov 9, 23:00 in Buenos Aires and Nov 10, 11:00 in
	// Tokyo. The saved zone dates a snapshot Nov 9; a request zone overrides it.
	it("is the saved one unless the request names another", async () => {
		const at = new Date("2026-11-10T02:00:00Z");
		const { db, store } = await open();
		await db.write(ACCOUNT_CREATE, createAccount({ ...wise, now: at }));
		expect(store.list("snapshots").map((s) => s.date.toISOString())).toEqual([
			"2026-11-09T00:00:00.000Z",
		]);
		await db.write(
			ACCOUNT_CREATE,
			createAccount({ ...wise, id: uuid(5), now: at, zone: "Asia/Tokyo" }),
		);
		expect(
			store
				.list("snapshots")
				.filter((s) => s.accountId === uuid(5))
				.map((s) => s.date.toISOString()),
		).toEqual(["2026-11-10T00:00:00.000Z"]);
	});
});

describe("close and reopen", () => {
	it("an account the person does not have is not found", async () => {
		const { db } = await open();
		await expect(
			db.write(ACCOUNT_CLOSE, closeAccount({ id: uuid(7), now: NOW })),
		).rejects.toThrow(NotFoundError);
	});
});

describe("edit", () => {
	it("an account the person does not have is not found, before anything else", async () => {
		const { db } = await open();
		await expect(
			db.write(
				ACCOUNT_UPDATE,
				updateAccount({
					...wise,
					id: uuid(7),
					legId: uuid(8),
					rateTypeId: uuid(9),
					now: NOW,
				}),
			),
		).rejects.toThrow(NotFoundError);
	});
});
