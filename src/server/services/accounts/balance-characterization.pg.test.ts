/**
 * M6 PR0: update balance, the rate type switch and the day's snapshot as they
 * behave today (the device twin M6a must change none of it). ARS home, Blue
 * 1 USD = 1,545 ARS, Official 1,050, Buenos Aires, clock pinned at
 * 2026-03-10T16:00Z (accounts/characterization-fixtures.ts).
 *
 * Hand-derived vectors:
 * - USD 1,000.00 at Blue is ARS 1,545,000.00; at Official, 1,050,000.00. The
 *   switch alone moves net worth by -495,000.00. Updating to USD 1,200.00 at
 *   Official writes a BALANCE_UPDATE leg of USD +200.00, booked at Official as
 *   ARS 210,000.00, so the whole write moves net worth by
 *   1,200 x 1,050 - 1,000 x 1,545 = -285,000.00.
 * - An ARS account at Official has a USD snapshot value of balance / 1,050:
 *   1,545,000.00 / 1,050 = 1,471.428571... = 1,471.43. An exact tie:
 *   1,544,996.25 / 1,050 = 1,471.425, which half-even rounds to 1,471.42
 *   (half-up would write 1,471.43), and -1,544,996.25 gives -1,471.42
 *   (half away from zero would write -1,471.43).
 */
import { MissingRateError } from "@retrospend/domain/money-dec";
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
import { createCallerFactory } from "~/server/api/trpc";
import { forUser } from "~/server/services/preview";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { wealthRouter } from "../../api/routers/wealth";
import {
	BUENOS_AIRES,
	MAR_10,
	PIN_INSTANT,
	seedCharacterizationRates,
	userIn,
} from "./characterization-fixtures";
import { closeAccount, createAccount, reopenAccount } from "./manage";
import { revertRateType, setRateType } from "./rate-type.mutation";
import { balanceOf, openAccount } from "./test-fixtures";
import { revertBalanceUpdate, updateBalance } from "./update-balance.mutation";

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

const ARS = (minor: number) => ({ minor, currency: "ARS" });
const delta = (
	r: { changes: readonly { id: string; delta: unknown }[] },
	id: string,
) => r.changes.find((c) => c.id === id)?.delta;

async function usdAtBlue(balance = 1000) {
	const { user } = await userIn(BUENOS_AIRES);
	const id = await openAccount(
		user.id,
		"USD at Blue",
		"INVESTMENT",
		"USD",
		balance,
		{
			exchangeRateType: "blue",
		},
	);
	return { userId: user.id, id };
}

const snapshots = (accountId: string) =>
	adminDb.assetSnapshot.findMany({
		where: { accountId },
		orderBy: { date: "asc" },
	});
const snap = (s: Awaited<ReturnType<typeof snapshots>>[number]) => ({
	date: s.date,
	balance: s.balance.toString(),
	usd: s.balanceInUSD.toString(),
	currency: s.currency,
	type: s.type,
	rateType: s.exchangeRateType,
});
const accountRow = (id: string) =>
	fixtureDb.assetAccount.findUniqueOrThrow({ where: { id } });

describe("account.updateBalance", () => {
	it("a new balance and a new rate type write a leg, a switch, the account and the day's snapshot", async () => {
		const { userId, id } = await usdAtBlue();
		const r = await forUser(userId).apply(updateBalance, {
			accountId: id,
			balance: "1200",
			rateType: "official",
		});

		expect(r.value).toMatchObject({
			change: { accountId: id, before: "1000", after: "1200" },
			notLogged: "200",
			previousRate: "1",
			rateSwitch: {
				from: "2026-03-10",
				rateType: "official",
				earlier: "blue",
				revaluation: ARS(-49_500_000),
			},
		});
		expect(delta(r, "netWorthChange.revaluation")).toEqual(ARS(-49_500_000));
		expect(delta(r, "netWorthChange.notLogged")).toEqual(ARS(21_000_000));
		expect(delta(r, "netWorth")).toEqual(ARS(-28_500_000));

		const legs = await adminDb.accountLeg.findMany({
			where: { accountId: id },
		});
		expect(
			legs.map((l) => [
				l.source,
				l.amount.toString(),
				l.homeAmount?.toString(),
				l.homeCurrency,
				l.date,
				l.transferId,
				l.expenseId,
				l.countedUnits.toString(),
			]),
		).toEqual([
			["BALANCE_UPDATE", "200", "210000", "ARS", MAR_10, null, null, "0"],
		]);
		expect(legs[0]?.id).toBe(r.value.legId);
		const row = await accountRow(id);
		expect([
			row.balance.toString(),
			row.exchangeRateType,
			row.exchangeRate?.toString(),
		]).toEqual(["1200", "official", "1"]);
		expect((await snapshots(id)).map(snap)).toEqual([
			expect.objectContaining({ balance: "1000", usd: "1000" }),
			{
				date: MAR_10,
				balance: "1200",
				usd: "1200",
				currency: "USD",
				type: "INVESTMENT",
				rateType: "official",
			},
		]);
		const switches = await adminDb.assetRateType.findMany({
			where: { accountId: id },
		});
		expect(switches.map((s) => [s.from, s.type, s.previousType])).toEqual([
			[MAR_10, "official", "blue"],
		]);
		expect(r.undo).toMatchObject({
			kind: "revert",
			mutation: "account.revertBalanceUpdate",
		});
	});

	it("keeping the rate type adds no switch, and a second write the same day replaces the day's snapshot", async () => {
		const { userId, id } = await usdAtBlue();
		const run = forUser(userId);
		await run.apply(updateBalance, { accountId: id, balance: "1200" });
		const second = await run.apply(updateBalance, {
			accountId: id,
			balance: "1300",
		});

		expect(second.value.rateSwitch).toBeNull();
		expect(second.value.notLogged).toBe("100");
		const legs = await adminDb.accountLeg.findMany({
			where: { accountId: id },
			orderBy: { amount: "desc" },
		});
		// At Blue: 200 x 1,545 and 100 x 1,545.
		expect(legs.map((l) => l.homeAmount?.toString())).toEqual([
			"309000",
			"154500",
		]);
		const rows = (await snapshots(id)).map(snap);
		expect(rows).toHaveLength(2);
		expect(rows[1]).toMatchObject({
			date: MAR_10,
			balance: "1300",
			usd: "1300",
		});
		expect(
			await adminDb.assetRateType.count({ where: { accountId: id } }),
		).toBe(0);
		// The history log appends on every write: opening, then each update.
		expect(await adminDb.assetHistory.count({ where: { assetId: id } })).toBe(
			3,
		);
	});

	it("an update that changes nothing writes no leg but still records the day", async () => {
		const { userId, id } = await usdAtBlue();
		const r = await forUser(userId).apply(updateBalance, {
			accountId: id,
			balance: "1000",
		});
		expect(r.value.legId).toBeNull();
		expect(r.value.notLogged).toBe("0");
		expect(await adminDb.accountLeg.count({ where: { accountId: id } })).toBe(
			0,
		);
		expect((await snapshots(id)).map((s) => s.date)).toEqual([
			expect.any(Date),
			MAR_10,
		]);
	});

	it("the same day's undo puts the balance, the type and the snapshot back", async () => {
		const { userId, id } = await usdAtBlue();
		const run = forUser(userId);
		const made = await run.apply(updateBalance, {
			accountId: id,
			balance: "1200",
			rateType: "official",
		});
		const undone = await run.apply(revertBalanceUpdate, {
			accountId: id,
			legId: made.value.legId,
			rateTypeId: made.value.rateSwitch?.rateTypeId ?? null,
			previousRate: made.value.previousRate,
		});

		expect(undone.value).toEqual({ accountId: id, balance: "1000" });
		expect(undone.undo).toMatchObject({
			kind: "revert",
			mutation: "account.updateBalance",
		});
		const row = await accountRow(id);
		expect([
			row.balance.toString(),
			row.exchangeRateType,
			row.exchangeRate?.toString(),
		]).toEqual(["1000", "blue", "1"]);
		expect(await adminDb.accountLeg.count({ where: { accountId: id } })).toBe(
			0,
		);
		expect(
			await adminDb.assetRateType.count({ where: { accountId: id } }),
		).toBe(0);
		expect((await snapshots(id)).map(snap)[1]).toEqual({
			date: MAR_10,
			balance: "1000",
			usd: "1000",
			currency: "USD",
			type: "INVESTMENT",
			rateType: "blue",
		});
	});

	it("the next day's undo of an update with a leg is refused and changes nothing", async () => {
		const { userId, id } = await usdAtBlue();
		const run = forUser(userId);
		const made = await run.apply(updateBalance, {
			accountId: id,
			balance: "1200",
			rateType: "official",
		});
		// Mar 11, 13:00 in Buenos Aires.
		vi.setSystemTime(new Date("2026-03-11T16:00:00Z"));
		await expect(
			run.apply(revertBalanceUpdate, {
				accountId: id,
				legId: made.value.legId,
				rateTypeId: made.value.rateSwitch?.rateTypeId ?? null,
				previousRate: made.value.previousRate,
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message:
				"Only today's balance update can be undone. Update the balance again.",
		});
		expect(await balanceOf(id)).toBe("1200");
		expect(await adminDb.accountLeg.count({ where: { accountId: id } })).toBe(
			1,
		);
		expect(
			await adminDb.assetRateType.count({ where: { accountId: id } }),
		).toBe(1);
	});

	it("an update that only switches the type has no leg, so its undo works on any later day", async () => {
		const { userId, id } = await usdAtBlue();
		const run = forUser(userId);
		const made = await run.apply(updateBalance, {
			accountId: id,
			balance: "1000",
			rateType: "official",
		});
		expect(made.value.legId).toBeNull();
		vi.setSystemTime(new Date("2026-03-11T16:00:00Z"));
		await run.apply(revertBalanceUpdate, {
			accountId: id,
			legId: null,
			rateTypeId: made.value.rateSwitch?.rateTypeId ?? null,
		});
		expect((await accountRow(id)).exchangeRateType).toBe("blue");
		expect(
			await adminDb.assetRateType.count({ where: { accountId: id } }),
		).toBe(0);
		// The revert records the day it ran on.
		expect(
			(await snapshots(id)).map((s) => s.date.toISOString().slice(0, 10)),
		).toEqual(["2026-02-28", "2026-03-10", "2026-03-11"]);
	});

	it("a closed account and another user's account are refused", async () => {
		const { userId, id } = await usdAtBlue();
		const other = await usdAtBlue();
		await closeAccount(adminDb, userId, id);
		await expect(
			forUser(userId).apply(updateBalance, { accountId: id, balance: "5" }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "This account is closed. Reopen it to change it.",
		});
		await expect(
			forUser(userId).apply(updateBalance, {
				accountId: other.id,
				balance: "5",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(await balanceOf(other.id)).toBe("1000");
	});

	it("the web's old dialog runs the same write", async () => {
		const { userId, id } = await usdAtBlue();
		const api = createCallerFactory(wealthRouter)({
			session: makeSession({ id: userId }),
			db: adminDb,
			headers: new Headers(),
		});
		const value = await api.updateAssetBalance({
			assetId: id,
			newBalance: 1200,
			exchangeRateType: "official",
		});
		expect(value).toMatchObject({
			notLogged: "200",
			rateSwitch: { rateType: "official", revaluation: ARS(-49_500_000) },
		});
		const leg = await adminDb.accountLeg.findFirstOrThrow({
			where: { accountId: id },
		});
		expect(leg.homeAmount?.toString()).toBe("210000");
	});
});

describe("account.setRateType", () => {
	it("blue to official revalues USD 1,000.00 from ARS 1,545,000.00 to 1,050,000.00 and writes no snapshot", async () => {
		const { userId, id } = await usdAtBlue();
		const r = await forUser(userId).apply(setRateType, {
			accountId: id,
			rateType: "official",
		});

		expect(r.value).toMatchObject({
			from: "2026-03-10",
			rateType: "official",
			earlier: "blue",
			revaluation: ARS(-49_500_000),
		});
		expect(delta(r, "netWorth")).toEqual(ARS(-49_500_000));
		expect((await accountRow(id)).exchangeRateType).toBe("official");
		expect(await snapshots(id)).toHaveLength(1);
		expect(await adminDb.accountLeg.count({ where: { accountId: id } })).toBe(
			0,
		);
		expect(r.undo).toMatchObject({
			kind: "revert",
			mutation: "account.revertRateType",
		});
	});

	it("a second switch the same day replaces the first from then on; removing the first keeps the second", async () => {
		const { userId, id } = await usdAtBlue();
		const run = forUser(userId);
		const first = await run.apply(setRateType, {
			accountId: id,
			rateType: "official",
		});
		await run.apply(setRateType, { accountId: id, rateType: "blue" });
		const rows = () =>
			adminDb.assetRateType.findMany({
				where: { accountId: id },
				orderBy: [{ from: "asc" }, { createdAt: "asc" }],
			});
		expect((await rows()).map((s) => [s.type, s.previousType])).toEqual([
			["official", "blue"],
			["blue", "official"],
		]);
		expect((await accountRow(id)).exchangeRateType).toBe("blue");

		await run.apply(revertRateType, { rateTypeId: first.value.rateTypeId });
		expect((await rows()).map((s) => [s.type, s.previousType])).toEqual([
			["blue", "blue"],
		]);
		expect((await accountRow(id)).exchangeRateType).toBe("blue");
	});

	it("the undo of the latest switch puts back the type before it", async () => {
		const { userId, id } = await usdAtBlue();
		const run = forUser(userId);
		const made = await run.apply(setRateType, {
			accountId: id,
			rateType: "official",
		});
		const undone = await run.apply(revertRateType, {
			rateTypeId: made.value.rateTypeId,
		});
		expect(undone.value).toEqual({ accountId: id, rateType: "blue" });
		expect(delta(undone, "netWorth")).toEqual(ARS(49_500_000));
		expect((await accountRow(id)).exchangeRateType).toBe("blue");
	});
});

describe("the USD value of a snapshot rounds half to even", () => {
	const open = async (
		userId: string,
		balance: number,
		rateType: string,
		type: "CASH" | "INVESTMENT" = "CASH",
	) => {
		const account = await createAccount(
			adminDb,
			userId,
			{
				name: `ARS at ${rateType}`,
				type,
				currency: "ARS",
				balance,
				exchangeRateType: rateType,
				isLiquid: true,
			},
			BUENOS_AIRES,
		);
		return (await snapshots(account.id)).map((s) => s.balanceInUSD.toString());
	};

	it("ARS 1,545,000.00 is USD 1,471.43 at Official and USD 1,000.00 at Blue", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		expect(await open(user.id, 1_545_000, "official")).toEqual(["1471.43"]);
		expect(await open(user.id, 1_545_000, "blue")).toEqual(["1000"]);
	});

	it("an exact tie goes to the even cent: 1,471.425 is 1,471.42, and its negative is -1,471.42", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		expect(await open(user.id, 1_544_996.25, "official")).toEqual(["1471.42"]);
		expect(await open(user.id, -1_544_996.25, "official")).toEqual([
			"-1471.42",
		]);
	});

	it("the update balance path rounds the same way", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		const id = await openAccount(user.id, "Pesos", "CASH", "ARS", 100, {
			exchangeRateType: "official",
		});
		await forUser(user.id).apply(updateBalance, {
			accountId: id,
			balance: "1544996.25",
		});
		expect((await snapshots(id)).at(-1)?.balanceInUSD.toString()).toBe(
			"1471.42",
		);
	});
});

describe("a missing rate refuses and is never 1", () => {
	it("create and update balance in a currency with no rate and no custom rate", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		await expect(
			createAccount(
				adminDb,
				user.id,
				{
					name: "Zed",
					type: "CASH",
					currency: "ZZZ",
					balance: 0,
					isLiquid: true,
				},
				BUENOS_AIRES,
			),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message:
				"No exchange rate found for ZZZ. Please sync rates or provide a custom rate.",
		});
		expect(
			await adminDb.assetAccount.count({ where: { userId: user.id } }),
		).toBe(0);

		const made = await createAccount(
			adminDb,
			user.id,
			{
				name: "Zed",
				type: "CASH",
				currency: "ZZZ",
				balance: 10,
				exchangeRate: 2,
				exchangeRateType: "custom",
				isLiquid: true,
			},
			BUENOS_AIRES,
		);
		expect(
			(await snapshots(made.id)).map((s) => s.balanceInUSD.toString()),
		).toEqual(["5"]);
		await expect(
			forUser(user.id).apply(updateBalance, {
				accountId: made.id,
				balance: "20",
				rateType: "blue",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(await balanceOf(made.id)).toBe("10");
		expect(
			await adminDb.accountLeg.count({ where: { accountId: made.id } }),
		).toBe(0);
	});

	it("reopening needs a rate unless the balance is zero", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		const zed = async (balance: number) => {
			const a = await createAccount(
				adminDb,
				user.id,
				{
					name: "Zed",
					type: "CASH",
					currency: "ZZZ",
					balance,
					exchangeRate: 2,
					exchangeRateType: "custom",
					isLiquid: true,
				},
				BUENOS_AIRES,
			);
			await closeAccount(adminDb, user.id, a.id);
			await adminDb.assetAccount.update({
				where: { id: a.id },
				data: { exchangeRate: null, exchangeRateType: null },
			});
			return a.id;
		};
		const held = await zed(10);
		await expect(reopenAccount(adminDb, user.id, held)).rejects.toBeInstanceOf(
			MissingRateError,
		);
		expect((await accountRow(held)).closedAt).not.toBeNull();

		const empty = await zed(0);
		await reopenAccount(adminDb, user.id, empty);
		expect((await accountRow(empty)).closedAt).toBeNull();
		expect((await snapshots(empty)).at(-1)?.balanceInUSD.toString()).toBe("0");
	});
});
