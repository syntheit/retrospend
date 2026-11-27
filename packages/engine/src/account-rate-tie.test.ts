/**
 * Two rate type switches on one account and day are ordered by `createdAt`
 * alone (rateSwitchPlan), so a device that books both in one millisecond (or
 * under a frozen clock) must not leave them equal: each local switch is
 * strictly later than every one the account holds. ARS home, blue 1,545,
 * official 1,050, USD account on blue.
 */
import { describe, expect, it } from "vitest";
import { seededAccountStore } from "./account-conformance";
import { ACCOUNT_SET_RATE_TYPE, setRateType } from "./account-rate-local";
import { uuid } from "./account-vectors";
import { BA, rate, seed } from "./expense-create-vectors";
import { LocalDb } from "./local-db";

const NOW = new Date("2026-11-10T15:00:00.000Z");
const A = uuid(1);

async function open() {
	const store = await seededAccountStore({
		name: "kit",
		seed: seed("ARS", BA, [
			rate("ARS", "blue", "1545", "2026-11-01T00:00:00Z"),
			rate("ARS", "official", "1050", "2026-11-01T00:00:00Z"),
			rate("ARS", "mep", "1300", "2026-11-01T00:00:00Z"),
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
	return { store, db: new LocalDb(store) };
}

const switchTo = (n: number, rateType: string, now = NOW) =>
	setRateType({ accountId: A, rateTypeId: uuid(10 + n), rateType, now });

describe("a local rate switch is strictly later than the ones the account holds", () => {
	it("two switches under one clock get instants a millisecond apart, in the order they were made", async () => {
		const { store, db } = await open();
		await db.write(ACCOUNT_SET_RATE_TYPE, switchTo(1, "official"));
		await db.write(ACCOUNT_SET_RATE_TYPE, switchTo(2, "mep"));
		await db.write(ACCOUNT_SET_RATE_TYPE, switchTo(3, "blue"));
		const times = [1, 2, 3].map((n) =>
			store.get("rateSwitches", uuid(10 + n))?.createdAt.getTime(),
		);
		expect(times).toEqual([
			NOW.getTime(),
			NOW.getTime() + 1,
			NOW.getTime() + 2,
		]);
		// The last one made is in force, and each remembers the type before it.
		expect(store.get("accounts", A)?.exchangeRateType).toBe("blue");
		expect(
			[1, 2, 3].map(
				(n) => store.get("rateSwitches", uuid(10 + n))?.previousType,
			),
		).toEqual(["blue", "official", "mep"]);
	});

	it("a clock behind a switch the device holds still orders after it", async () => {
		const { store, db } = await open();
		await db.write(ACCOUNT_SET_RATE_TYPE, switchTo(1, "official"));
		await db.write(
			ACCOUNT_SET_RATE_TYPE,
			switchTo(2, "mep", new Date(NOW.getTime() - 60_000)),
		);
		expect(store.get("rateSwitches", uuid(12))?.createdAt.getTime()).toBe(
			NOW.getTime() + 1,
		);
	});

	it("leaves a switch with a later clock at that clock", async () => {
		const { store, db } = await open();
		await db.write(ACCOUNT_SET_RATE_TYPE, switchTo(1, "official"));
		const later = new Date(NOW.getTime() + 5000);
		await db.write(ACCOUNT_SET_RATE_TYPE, switchTo(2, "mep", later));
		expect(store.get("rateSwitches", uuid(12))?.createdAt.getTime()).toBe(
			later.getTime(),
		);
	});
});
