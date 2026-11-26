/**
 * M6 PR0: account create, edit, close, reopen, delete and restore as they
 * behave today. ARS home, Blue 1 USD = 1,545 ARS, Official 1,050, Buenos
 * Aires, clock pinned at 2026-03-10T16:00Z (characterization-fixtures.ts).
 *
 * Hand-derived: an ARS account with no rate type takes the default pick,
 * Blue 1,545, so ARS 1,000.00 has a snapshot value of 1,000 / 1,545 =
 * 0.647249... = USD 0.65. ARS 1,545,000.00 at Official is 1,545,000 / 1,050 =
 * 1,471.428571... = USD 1,471.43.
 */
import { randomUUID } from "node:crypto";
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
import { userTransaction } from "~/server/db-tx";
import {
	deleteAccountMutation,
	undeleteAccountMutation,
} from "~/server/services/api-v1/accounts/mutations";
import { forUser } from "~/server/services/preview";
import { createTransfer } from "~/server/services/transfers/create.mutation";
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
import {
	closeAccount,
	createAccount,
	createAccountIn,
	editAccount,
	reopenAccount,
} from "./manage";
import { balanceOf, openAccount } from "./test-fixtures";
import { updateBalance } from "./update-balance.mutation";

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

const accountRow = (id: string) =>
	fixtureDb.assetAccount.findUniqueOrThrow({ where: { id } });
const snapshots = (accountId: string) =>
	adminDb.assetSnapshot.findMany({
		where: { accountId },
		orderBy: { date: "asc" },
	});
const history = (assetId: string) =>
	adminDb.assetHistory.count({ where: { assetId } });
const legCount = (accountId: string) =>
	adminDb.accountLeg.count({ where: { accountId } });
const tomorrow = () => vi.setSystemTime(new Date("2026-03-11T16:00:00Z"));

const usd = (over: Record<string, unknown> = {}) => ({
	name: "Wise",
	type: "INVESTMENT" as const,
	currency: "USD",
	balance: 250.5,
	exchangeRateType: "blue",
	isLiquid: false,
	...over,
});

describe("create", () => {
	it("writes the row, one snapshot and one history entry, and no leg", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		const account = await createAccount(adminDb, user.id, usd());

		const row = await accountRow(account.id);
		expect(row).toMatchObject({
			name: "Wise",
			type: "INVESTMENT",
			currency: "USD",
			exchangeRateType: "blue",
			isLiquid: false,
			inBudget: null,
			interestRate: null,
			minimumPayment: null,
			dueDate: null,
			closedAt: null,
			iconKind: null,
			iconValue: null,
			updatedAt: PIN_INSTANT,
		});
		expect([
			row.balance.toString(),
			row.exchangeRate?.toString(),
			row.countedUnits.toString(),
		]).toEqual(["250.5", "1", "0"]);
		const [snap, ...rest] = await snapshots(account.id);
		expect(rest).toEqual([]);
		expect(snap).toMatchObject({
			date: MAR_10,
			currency: "USD",
			type: "INVESTMENT",
			exchangeRateType: "blue",
		});
		expect([snap?.balance.toString(), snap?.balanceInUSD.toString()]).toEqual([
			"250.5",
			"250.5",
		]);
		expect(await history(account.id)).toBe(1);
		expect(await legCount(account.id)).toBe(0);
	});

	it("an ARS account with no rate type takes the default pick, Blue", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		const account = await createAccount(adminDb, user.id, {
			name: "Pesos",
			type: "CASH",
			currency: "ARS",
			balance: 1000,
			isLiquid: true,
		});
		const row = await accountRow(account.id);
		expect([row.exchangeRateType, row.exchangeRate?.toString()]).toEqual([
			"blue",
			"1545",
		]);
		expect((await snapshots(account.id))[0]?.balanceInUSD.toString()).toBe(
			"0.65",
		);
	});

	it("takes a client id, and a taken id is refused", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		const id = randomUUID();
		const make = () =>
			userTransaction(adminDb, user.id, (tx) =>
				createAccountIn(tx, user.id, { ...usd(), id }),
			);
		expect((await make()).id).toBe(id);
		await expect(make()).rejects.toThrow();
		expect(
			await adminDb.assetAccount.count({ where: { userId: user.id } }),
		).toBe(1);
	});

	it("the web router creates the same row", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		const api = createCallerFactory(wealthRouter)({
			session: makeSession({ id: user.id }),
			db: adminDb,
			headers: new Headers(),
		});
		const account = await api.createAsset({
			name: "Wise",
			type: "INVESTMENT",
			currency: "USD",
			balance: 250.5,
			exchangeRateType: "blue",
			isLiquid: false,
		});
		expect((await accountRow(account.id)).balance.toString()).toBe("250.5");
		expect(await snapshots(account.id)).toHaveLength(1);
	});
});

describe("edit", () => {
	it("an edit with every field as it was still records the day's snapshot and a history entry", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		const id = await openAccount(user.id, "Wise", "INVESTMENT", "USD", 1000, {
			exchangeRateType: "blue",
		});
		await editAccount(adminDb, user.id, id, {
			name: "Wise renamed",
			type: "INVESTMENT",
			currency: "USD",
			balance: 1000,
			exchangeRateType: "blue",
			isLiquid: false,
		});
		expect((await accountRow(id)).name).toBe("Wise renamed");
		expect(await balanceOf(id)).toBe("1000");
		expect(await legCount(id)).toBe(0);
		expect(
			await adminDb.assetRateType.count({ where: { accountId: id } }),
		).toBe(0);
		expect((await snapshots(id)).map((s) => s.date)).toEqual([
			expect.any(Date),
			MAR_10,
		]);
		expect(await history(id)).toBe(2);
	});

	it("a new balance is a checkpoint leg and a new rate type is a dated switch", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		const id = await openAccount(user.id, "Wise", "INVESTMENT", "USD", 1000, {
			exchangeRateType: "blue",
		});
		await editAccount(adminDb, user.id, id, {
			name: "Wise",
			type: "INVESTMENT",
			currency: "USD",
			balance: 1200,
			exchangeRateType: "official",
			isLiquid: false,
		});
		const legs = await adminDb.accountLeg.findMany({
			where: { accountId: id },
		});
		expect(
			legs.map((l) => [
				l.source,
				l.amount.toString(),
				l.homeAmount?.toString(),
			]),
		).toEqual([["BALANCE_UPDATE", "200", "210000"]]);
		const switches = await adminDb.assetRateType.findMany({
			where: { accountId: id },
		});
		expect(switches.map((s) => [s.from, s.type, s.previousType])).toEqual([
			[MAR_10, "official", "blue"],
		]);
		expect((await accountRow(id)).exchangeRateType).toBe("official");
	});

	it("once legs exist the currency and the side of net worth cannot change", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		const id = await openAccount(user.id, "Wise", "INVESTMENT", "USD", 1000, {
			exchangeRateType: "blue",
		});
		await forUser(user.id).apply(updateBalance, {
			accountId: id,
			balance: "1100",
		});
		const same = {
			name: "Wise",
			type: "INVESTMENT" as const,
			currency: "USD",
			balance: 1100,
			exchangeRateType: "blue",
			isLiquid: false,
		};
		await expect(
			editAccount(adminDb, user.id, id, { ...same, currency: "ARS" }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message:
				"Money moved through this account in its currency. Add a new account instead.",
		});
		await expect(
			editAccount(adminDb, user.id, id, { ...same, type: "LIABILITY_LOAN" }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message:
				"Money moved through this account as something you have or owe. Add a new account instead.",
		});
		// Same side is allowed: an investment becomes cash.
		await editAccount(adminDb, user.id, id, { ...same, type: "CASH" });
		const row = await accountRow(id);
		expect([row.type, row.currency]).toEqual(["CASH", "USD"]);
	});

	it("with no legs yet the currency can change", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		const id = await openAccount(user.id, "Wise", "CASH", "USD", 10, {
			exchangeRateType: "blue",
		});
		await editAccount(adminDb, user.id, id, {
			name: "Wise",
			type: "CASH",
			currency: "ARS",
			balance: 10,
			isLiquid: true,
		});
		expect((await accountRow(id)).currency).toBe("ARS");
	});

	it("a closed account and another user's account cannot be edited", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		const other = await userIn(BUENOS_AIRES);
		const id = await openAccount(user.id, "Wise", "CASH", "USD", 10, {
			exchangeRateType: "blue",
		});
		const fields = usd({ type: "CASH" });
		await closeAccount(adminDb, user.id, id);
		await expect(
			editAccount(adminDb, user.id, id, fields),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "This account is closed. Reopen it to change it.",
		});
		await expect(
			editAccount(adminDb, other.user.id, id, fields),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("the web router edits through the same function", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		const id = await openAccount(user.id, "Wise", "CASH", "USD", 10, {
			exchangeRateType: "blue",
		});
		const api = createCallerFactory(wealthRouter)({
			session: makeSession({ id: user.id }),
			db: adminDb,
			headers: new Headers(),
		});
		await api.updateAsset({ id, ...usd({ type: "CASH", balance: 12 }) });
		expect(await balanceOf(id)).toBe("12");
		expect(await legCount(id)).toBe(1);
	});
});

describe("close and reopen", () => {
	it("close keeps the balance, stamps the instant and writes a zero snapshot for the day", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		const id = await openAccount(user.id, "Wise", "CASH", "USD", 1000, {
			exchangeRateType: "blue",
		});
		const before = await history(id);
		expect(await closeAccount(adminDb, user.id, id)).toEqual({ success: true });

		const row = await accountRow(id);
		expect(row.closedAt).toEqual(PIN_INSTANT);
		expect(row.balance.toString()).toBe("1000");
		const today = (await snapshots(id)).at(-1);
		expect(today).toMatchObject({ date: MAR_10 });
		expect([today?.balance.toString(), today?.balanceInUSD.toString()]).toEqual(
			["0", "0"],
		);
		expect(await history(id)).toBe(before + 1);
	});

	it("closing a closed account and reopening an open one succeed and change nothing", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		const id = await openAccount(user.id, "Wise", "CASH", "USD", 1000, {
			exchangeRateType: "blue",
		});
		const open = await accountRow(id);
		const openHistory = await history(id);
		tomorrow();
		expect(await reopenAccount(adminDb, user.id, id)).toEqual({
			success: true,
		});
		expect(await accountRow(id)).toEqual(open);
		expect(await history(id)).toBe(openHistory);

		vi.setSystemTime(PIN_INSTANT);
		await closeAccount(adminDb, user.id, id);
		const closed = await accountRow(id);
		const closedSnapshots = await snapshots(id);
		const closedHistory = await history(id);
		tomorrow();
		expect(await closeAccount(adminDb, user.id, id)).toEqual({ success: true });
		expect(await accountRow(id)).toEqual(closed);
		expect(await snapshots(id)).toEqual(closedSnapshots);
		expect(await history(id)).toBe(closedHistory);
	});

	it("reopen brings the balance back for the day, and the day keeps one snapshot", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		const id = await openAccount(user.id, "Pesos", "CASH", "ARS", 1_545_000, {
			exchangeRateType: "official",
		});
		await closeAccount(adminDb, user.id, id);
		await reopenAccount(adminDb, user.id, id);

		expect((await accountRow(id)).closedAt).toBeNull();
		const days = (await snapshots(id)).filter(
			(s) => s.date.getTime() === MAR_10.getTime(),
		);
		expect(days).toHaveLength(1);
		// 1,545,000 / 1,050 = 1,471.428571..., to cents.
		expect([
			days[0]?.balance.toString(),
			days[0]?.balanceInUSD.toString(),
		]).toEqual(["1545000", "1471.43"]);
		expect(days[0]?.exchangeRateType).toBe("official");
	});

	it("another user's account is not found", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		const other = await userIn(BUENOS_AIRES);
		const id = await openAccount(other.user.id, "Wise", "CASH", "USD", 10, {
			exchangeRateType: "blue",
		});
		await expect(closeAccount(adminDb, user.id, id)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		await expect(reopenAccount(adminDb, user.id, id)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("delete and restore (the v1 pair)", () => {
	it("restores the account with its balance, its updatedAt, its history and the moves that pointed at it", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		const savings = await openAccount(
			user.id,
			"Savings",
			"CASH",
			"ARS",
			5_000_000,
		);
		const wise = await openAccount(user.id, "Wise", "INVESTMENT", "USD", 1000, {
			exchangeRateType: "blue",
		});
		const run = forUser(user.id);
		await run.apply(updateBalance, { accountId: wise, balance: "1200" });
		const moved = await run.apply(createTransfer, {
			fromAccountId: savings,
			toAccountId: wise,
			fromAmount: "154500",
		});
		const before = await accountRow(wise);
		const legsBefore = await legCount(wise);
		const snapshotsBefore = (await snapshots(wise)).length;
		expect(before.balance.toString()).toBe("1300");

		tomorrow();
		const deleted = await run.apply(deleteAccountMutation, { id: wise });
		expect(await adminDb.assetAccount.count({ where: { id: wise } })).toBe(0);
		expect(await legCount(wise)).toBe(0);
		// The other side of the move stays, pointing at nothing.
		const orphan = await fixtureDb.transfer.findUniqueOrThrow({
			where: { id: moved.value.transferId },
		});
		expect(orphan.toAccountId).toBeNull();
		expect(await balanceOf(savings)).toBe("4845500");

		vi.setSystemTime(new Date("2026-03-11T20:00:00Z"));
		await run.apply(undeleteAccountMutation, { stash: deleted.value.stash });
		const after = await accountRow(wise);
		expect(after.balance.toString()).toBe("1300");
		expect(after.countedUnits.toString()).toBe("0");
		// updatedAt is the one it had before the delete, not the restore's day.
		expect(after.updatedAt).toEqual(before.updatedAt);
		expect(after.createdAt).toEqual(before.createdAt);
		expect(await legCount(wise)).toBe(legsBefore);
		expect((await snapshots(wise)).length).toBe(snapshotsBefore);
		expect(
			(
				await fixtureDb.transfer.findUniqueOrThrow({
					where: { id: moved.value.transferId },
				})
			).toAccountId,
		).toBe(wise);
	});

	it("the delete of an unknown account is not found, and a delete then a restore leaves one account", async () => {
		const { user } = await userIn(BUENOS_AIRES);
		const id = await openAccount(user.id, "Wise", "CASH", "USD", 10, {
			exchangeRateType: "blue",
		});
		const run = forUser(user.id);
		const deleted = await run.apply(deleteAccountMutation, { id });
		await run.apply(undeleteAccountMutation, { stash: deleted.value.stash });
		await expect(
			run.apply(deleteAccountMutation, { id: randomUUID() }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(
			await adminDb.assetAccount.count({ where: { userId: user.id } }),
		).toBe(1);
	});
});
