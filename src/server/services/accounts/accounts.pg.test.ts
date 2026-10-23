/**
 * Accounts on real Postgres through the preview runner and RLS (2D.1):
 * Update balance writes a checkpoint and its Not logged leg, keeps the sign
 * and the rate rules the old dialog had; a rate type switch is a dated
 * revaluation (D3); default accounts; the new tables are each user's own.
 * Rates: ARS 1,468 Blue, 1,412 Official, 1,449 MEP per USD (test-fixtures).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createCallerFactory } from "~/server/api/trpc";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { makeSession } from "~/test/trpc-test-utils";
import { wealthRouter } from "../../api/routers/wealth";
import { defaultAccounts, setDefaultAccount } from "./defaults";
import { closeAccount, editAccount } from "./manage";
import { revertRateType, setRateType } from "./rate-type.mutation";
import {
	arsUser,
	balanceOf,
	figureMinor,
	openAccount,
	seedArsRates,
	TODAY,
} from "./test-fixtures";
import { revertBalanceUpdate, updateBalance } from "./update-balance.mutation";

const todaySnapshot = (accountId: string) =>
	adminDb.assetSnapshot.findUnique({
		where: { accountId_date: { accountId, date: TODAY } },
	});

beforeAll(seedArsRates);

describe("account.updateBalance", () => {
	it("values the new balance at today's rate of the account's type", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Savings", "CASH", "ARS", 1_000_000, {
			exchangeRateType: "official",
		});
		await adminDb.assetAccount.update({
			where: { id },
			data: { exchangeRate: 900 },
		});

		await forUser(user.id).apply(updateBalance, {
			accountId: id,
			balance: "1412000",
		});

		const account = await adminDb.assetAccount.findUniqueOrThrow({
			where: { id },
		});
		expect(account.exchangeRate?.toString()).toBe("1412");
		expect(account.exchangeRateType).toBe("official");
		const snapshot = await todaySnapshot(id);
		expect(Number(snapshot?.balanceInUSD)).toBeCloseTo(1000, 2);
		expect(snapshot).toMatchObject({
			currency: "ARS",
			type: "CASH",
			exchangeRateType: "official",
		});
	});

	it("keeps a custom rate and the sign typed", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Overdraft", "CASH", "ARS", 2000, {
			exchangeRateType: "custom",
			exchangeRate: 2000,
		});

		await forUser(user.id).apply(updateBalance, {
			accountId: id,
			balance: "-4000",
		});

		expect(await balanceOf(id)).toBe("-4000");
		expect(Number((await todaySnapshot(id))?.balanceInUSD)).toBeCloseTo(-2, 2);
	});

	it("writes the Not logged difference as a leg (update balance writes a leg)", async () => {
		const { user } = await arsUser();
		const wallet = await openAccount(
			user.id,
			"Digital wallet",
			"CASH",
			"ARS",
			1_000_000,
		);
		const card = await openAccount(
			user.id,
			"Credit card",
			"LIABILITY_CREDIT_CARD",
			"ARS",
			842_600,
		);

		const result = await forUser(user.id).apply(updateBalance, {
			accountId: wallet,
			balance: "987700",
		});
		await forUser(user.id).apply(updateBalance, {
			accountId: card,
			balance: "900000",
		});

		expect(result.value.notLogged).toBe("-12300");
		const legs = await adminDb.accountLeg.findMany({
			where: { userId: user.id },
			orderBy: { createdAt: "asc" },
		});
		expect(
			legs.map((l) => [l.accountId, l.source, l.amount.toString()]),
		).toEqual([
			[wallet, "BALANCE_UPDATE", "-12300"],
			// Owing ARS 57,400 more on the card is ARS 57,400 less of yours.
			[card, "BALANCE_UPDATE", "-57400"],
		]);
		expect(
			result.changes.find((c) => c.id === "netWorthChange.notLogged")?.delta,
		).toEqual({
			minor: -1_230_000,
			currency: "ARS",
		});
	});

	it("a closed account takes no balance updates until it is reopened", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Old cash", "CASH", "ARS", 5000);
		await closeAccount(adminDb, user.id, id);
		const closedAt = await todaySnapshot(id);

		await expect(
			forUser(user.id).apply(updateBalance, { accountId: id, balance: "1" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect((await todaySnapshot(id))?.balance.toString()).toBe(
			closedAt?.balance.toString(),
		);
	});

	it("undo puts today's balance and its snapshot back", async () => {
		const { user } = await arsUser();
		const id = await openAccount(
			user.id,
			"Digital wallet",
			"CASH",
			"ARS",
			1_000_000,
		);
		const { value } = await forUser(user.id).apply(updateBalance, {
			accountId: id,
			balance: "987700",
		});

		await forUser(user.id).apply(revertBalanceUpdate, {
			accountId: id,
			legId: value.legId,
			rateTypeId: null,
		});

		expect(await balanceOf(id)).toBe("1000000");
		expect((await todaySnapshot(id))?.balance.toString()).toBe("1000000");
		expect(await adminDb.accountLeg.count({ where: { accountId: id } })).toBe(
			0,
		);
	});

	it("the old Update balance dialog runs the same mutation", async () => {
		const { user } = await arsUser();
		const id = await openAccount(
			user.id,
			"Digital wallet",
			"CASH",
			"ARS",
			1_000_000,
		);
		const caller = createCallerFactory(wealthRouter)({
			session: makeSession({ id: user.id }),
			db: adminDb,
			headers: new Headers(),
		});

		await caller.updateAssetBalance({ assetId: id, newBalance: 990_000 });

		expect(await balanceOf(id)).toBe("990000");
		expect(
			await adminDb.accountLeg.count({
				where: { accountId: id, source: "BALANCE_UPDATE" },
			}),
		).toBe(1);
	});
});

describe("account.setRateType (D3)", () => {
	it("a switch is a dated revaluation; earlier days keep their type", async () => {
		const { user } = await arsUser();
		const wise = await openAccount(
			user.id,
			"Wise",
			"INVESTMENT",
			"USD",
			1840.55,
			{
				exchangeRateType: "official",
			},
		);
		const before = await figureMinor(user.id, "netWorth");

		const result = await forUser(user.id).apply(setRateType, {
			accountId: wise,
			rateType: "blue",
		});

		// USD 1,840.55 x (1,468 - 1,412) = ARS 103,070.80
		expect(result.value.revaluation).toEqual({
			minor: 10_307_080,
			currency: "ARS",
		});
		expect(result.value.earlier).toBe("official");
		expect((await figureMinor(user.id, "netWorth")) ?? 0).toBe(
			(before ?? 0) + 10_307_080,
		);
		const rows = await adminDb.assetRateType.findMany({
			where: { accountId: wise },
		});
		expect(
			rows.map((r) => [
				r.from.toISOString().slice(0, 10),
				r.type,
				r.previousType,
			]),
		).toEqual([[result.value.from, "blue", "official"]]);

		await forUser(user.id).apply(revertRateType, {
			rateTypeId: result.value.rateTypeId,
		});

		expect(
			(await adminDb.assetAccount.findUniqueOrThrow({ where: { id: wise } }))
				.exchangeRateType,
		).toBe("official");
		expect(await figureMinor(user.id, "netWorth")).toBe(before);
	});
});

describe("account set-up", () => {
	it("an account with money moves keeps its currency", async () => {
		const { user } = await arsUser();
		const id = await openAccount(
			user.id,
			"Digital wallet",
			"CASH",
			"ARS",
			1_000_000,
		);
		await forUser(user.id).apply(updateBalance, {
			accountId: id,
			balance: "999000",
		});

		await expect(
			editAccount(adminDb, user.id, id, {
				name: "Digital wallet",
				type: "CASH",
				currency: "USD",
				balance: 999_000,
				isLiquid: true,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("an edited balance is a checkpoint with its Not logged leg", async () => {
		const { user } = await arsUser();
		const id = await openAccount(
			user.id,
			"Digital wallet",
			"CASH",
			"ARS",
			1_000_000,
		);

		await editAccount(adminDb, user.id, id, {
			name: "Wallet",
			type: "CASH",
			currency: "ARS",
			balance: 1_010_000,
			isLiquid: true,
			inBudget: false,
		});

		const account = await adminDb.assetAccount.findUniqueOrThrow({
			where: { id },
		});
		expect(account).toMatchObject({ name: "Wallet", inBudget: false });
		expect(account.balance.toString()).toBe("1010000");
		const leg = await adminDb.accountLeg.findFirstOrThrow({
			where: { accountId: id },
		});
		expect(leg.amount.toString()).toBe("10000");
	});

	it("keeps one default account per currency, an open one in that currency", async () => {
		const { user } = await arsUser();
		const wallet = await openAccount(
			user.id,
			"Digital wallet",
			"CASH",
			"ARS",
			0,
		);
		const wise = await openAccount(user.id, "Wise", "INVESTMENT", "USD", 0);

		await setDefaultAccount(adminDb, user.id, "ARS", wallet);
		await setDefaultAccount(adminDb, user.id, "USD", wise);
		await expect(
			setDefaultAccount(adminDb, user.id, "ARS", wise),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
		expect(await defaultAccounts(adminDb, user.id)).toEqual({
			ARS: wallet,
			USD: wise,
		});

		await setDefaultAccount(adminDb, user.id, "USD", null);
		expect(await defaultAccounts(adminDb, user.id)).toEqual({ ARS: wallet });
	});
});

describe("RLS on the M4 tables", () => {
	it("legs, transfers and rate type switches are each user's own", async () => {
		const owner = await arsUser();
		const other = await arsUser();
		const wise = await openAccount(
			owner.user.id,
			"Wise",
			"INVESTMENT",
			"USD",
			100,
			{
				exchangeRateType: "official",
			},
		);
		await forUser(owner.user.id).apply(updateBalance, {
			accountId: wise,
			balance: "200",
		});
		await forUser(owner.user.id).apply(setRateType, {
			accountId: wise,
			rateType: "blue",
		});

		expect(await owner.db.accountLeg.count()).toBe(1);
		expect(await owner.db.assetRateType.count()).toBe(1);
		expect(await other.db.accountLeg.count()).toBe(0);
		expect(await other.db.assetRateType.count()).toBe(0);
		expect(await other.db.transfer.count()).toBe(0);
		await expect(
			forUser(other.user.id).apply(updateBalance, {
				accountId: wise,
				balance: "0",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			other.db.accountLeg.create({
				data: {
					userId: owner.user.id,
					accountId: wise,
					currency: "USD",
					amount: "1",
					date: TODAY,
					source: "BALANCE_UPDATE",
				},
			}),
		).rejects.toThrow();
	});
});
