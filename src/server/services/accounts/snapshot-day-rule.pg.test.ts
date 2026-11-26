/**
 * M6 PR0: which day an account's snapshot lands on, per write path. Close and
 * reopen use the UTC day (manage.ts closeAccountIn, reopenAccountIn); create,
 * edit and update balance use the person's zone (checkpointDay, moveDay). The
 * two disagree whenever the zone's day is not the UTC day, so each vector
 * sits at an instant where they differ. Pinned as they are: the owner
 * decides later whether the two should become one rule.
 *
 * - 2026-03-10T16:00Z: Mar 10 in UTC, Mar 11 01:00 in Tokyo (UTC+9).
 * - 2026-03-10T02:00Z: Mar 10 in UTC, Mar 9 23:00 in Buenos Aires (UTC-3).
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import {
	BUENOS_AIRES,
	MAR_11,
	PIN_INSTANT,
	seedCharacterizationRates,
	TOKYO,
	userIn,
} from "./characterization-fixtures";
import {
	closeAccount,
	createAccount,
	editAccount,
	reopenAccount,
} from "./manage";
import { updateBalance } from "./update-balance.mutation";

const MAR_9 = new Date("2026-03-09T00:00:00Z");
const BA_LATE_NIGHT = new Date("2026-03-10T02:00:00Z");

let dropRates: () => Promise<unknown>;
beforeAll(async () => {
	dropRates = await seedCharacterizationRates();
});
afterAll(() => dropRates());
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], now: PIN_INSTANT });
});
afterEach(() => {
	vi.useRealTimers();
});

const fields = {
	name: "Wise",
	type: "CASH" as const,
	currency: "USD",
	balance: 1000,
	exchangeRateType: "blue",
	isLiquid: true,
};
const days = async (accountId: string) =>
	(
		await adminDb.assetSnapshot.findMany({
			where: { accountId },
			orderBy: { date: "asc" },
			select: { date: true, balance: true },
		})
	).map((s) => [s.date.toISOString().slice(0, 10), s.balance.toString()]);

describe("east of UTC: Tokyo is already Mar 11 when UTC is Mar 10", () => {
	it("create, edit and update balance use Tokyo's day; close and reopen use the UTC day", async () => {
		const { user } = await userIn(TOKYO);
		const account = await createAccount(adminDb, user.id, fields);
		expect(await days(account.id)).toEqual([["2026-03-11", "1000"]]);

		await editAccount(adminDb, user.id, account.id, {
			...fields,
			balance: 1100,
		});
		await forUser(user.id).apply(updateBalance, {
			accountId: account.id,
			balance: "1200",
		});
		// Both land on Tokyo's day, replacing the one snapshot it has.
		expect(await days(account.id)).toEqual([["2026-03-11", "1200"]]);
		const leg = await adminDb.accountLeg.findMany({
			where: { accountId: account.id },
			orderBy: { amount: "asc" },
		});
		expect(leg.map((l) => [l.date, l.amount.toString()])).toEqual([
			[MAR_11, "100"],
			[MAR_11, "100"],
		]);

		await closeAccount(adminDb, user.id, account.id);
		// A day before the account's own last balance: it closes "before" it was last set.
		expect(await days(account.id)).toEqual([
			["2026-03-10", "0"],
			["2026-03-11", "1200"],
		]);

		await reopenAccount(adminDb, user.id, account.id);
		expect(await days(account.id)).toEqual([
			["2026-03-10", "1200"],
			["2026-03-11", "1200"],
		]);
	});

	it("an explicit zone moves create to that zone's day", async () => {
		const { user } = await userIn(TOKYO);
		const account = await createAccount(adminDb, user.id, fields, "UTC");
		expect(await days(account.id)).toEqual([["2026-03-10", "1000"]]);
	});
});

describe("west of UTC: Buenos Aires is still Mar 9 when UTC is Mar 10", () => {
	it("create and update balance use the 9th; close and reopen use the 10th", async () => {
		vi.setSystemTime(BA_LATE_NIGHT);
		const { user } = await userIn(BUENOS_AIRES);
		const account = await createAccount(adminDb, user.id, fields);
		expect(await days(account.id)).toEqual([["2026-03-09", "1000"]]);

		await forUser(user.id).apply(updateBalance, {
			accountId: account.id,
			balance: "1500",
		});
		expect(await days(account.id)).toEqual([["2026-03-09", "1500"]]);
		const leg = await adminDb.accountLeg.findFirstOrThrow({
			where: { accountId: account.id },
		});
		expect(leg.date).toEqual(MAR_9);

		await closeAccount(adminDb, user.id, account.id);
		await reopenAccount(adminDb, user.id, account.id);
		expect(await days(account.id)).toEqual([
			["2026-03-09", "1500"],
			["2026-03-10", "1500"],
		]);
	});
});
