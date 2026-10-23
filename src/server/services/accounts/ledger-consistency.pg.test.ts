/**
 * The account ledger stays consistent on real Postgres (2D review fixes):
 * old balance updates keep their order after M4, a leg deleted after a
 * later balance update leaves every reader agreeing, checkpoints and legs
 * share the user's day, an account with legs keeps its side of net worth,
 * undo puts back exactly what it took, and two opposite transfers never
 * deadlock. USD home unless named; ARS rates from test-fixtures.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { figures, readFiguresIn } from "~/server/figures/registry";
import { addIncome } from "~/server/services/income/add.mutation";
import { deleteIncome } from "~/server/services/income/delete.mutation";
import { forUser } from "~/server/services/preview";
import { createTransfer } from "~/server/services/transfers/create.mutation";
import { deleteTransfer } from "~/server/services/transfers/delete.mutation";
import { WealthService } from "~/server/services/wealth.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { editAccount } from "./manage";
import { revertRateType, setRateType } from "./rate-type.mutation";
import {
	arsUser,
	balanceOf,
	daysAgo,
	figureMinor,
	isoDay,
	openAccount,
	seedArsRates,
	TODAY,
} from "./test-fixtures";
import { revertBalanceUpdate, updateBalance } from "./update-balance.mutation";

const MIGRATIONS = fileURLToPath(
	new URL("../../../../prisma/migrations/", import.meta.url),
);

/** Found by suffix: the timestamp is a placeholder until merge. */
function m4Sql(): string {
	const folder = readdirSync(MIGRATIONS).find((name) =>
		name.endsWith("_accounts_legs_transfers"),
	);
	if (!folder) throw new Error("accounts_legs_transfers migration not found");
	return readFileSync(`${MIGRATIONS}${folder}/migration.sql`, "utf8");
}

const usd = (major: number) => ({
	minor: Math.round(major * 100),
	currency: "USD",
});

async function snapshotOn(accountId: string, date: Date) {
	return adminDb.assetSnapshot.findUniqueOrThrow({
		where: { accountId_date: { accountId, date } },
	});
}

beforeAll(seedArsRates);

describe("M4 on a database with balance updates from before it", () => {
	it("backfills recordedAt to each snapshot's day, so an old update is not Not logged from zero", async () => {
		const { user } = await createTestUser();
		const account = await adminDb.assetAccount.create({
			data: {
				userId: user.id,
				name: "Checking",
				type: "CASH",
				currency: "USD",
				balance: 1000,
				exchangeRate: 1,
			},
		});
		const client = new Client({ connectionString: process.env.DATABASE_URL });
		await client.connect();
		try {
			// The table as it was before M4, with two balance updates written then.
			await client.query("BEGIN");
			await client.query(
				`ALTER TABLE "asset_snapshot" DROP COLUMN "recordedAt"`,
			);
			for (const [date, balance] of [
				[daysAgo(40), 900],
				[daysAgo(5), 1000],
			] as const) {
				await client.query(
					`INSERT INTO "asset_snapshot" ("id", "accountId", "userId", "date", "balance", "balanceInUSD", "currency", "type")
					 VALUES ($1, $2, $3, $4, $5, $5, 'USD', 'CASH')`,
					[randomUUID(), account.id, user.id, date, balance],
				);
			}
			await client.query(m4Sql());
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			await client.end();
		}

		const rows = await adminDb.assetSnapshot.findMany({
			where: { accountId: account.id },
			orderBy: { date: "asc" },
		});
		expect(rows.map((r) => r.recordedAt.getTime())).toEqual(
			rows.map((r) => r.date.getTime()),
		);
		// The update five days ago raised 900 to 1,000: Not logged +100, no revaluation.
		expect(await figureMinor(user.id, "netWorthChange.notLogged", "USD")).toBe(
			10_000,
		);
		expect(
			await figureMinor(user.id, "netWorthChange.revaluation", "USD"),
		).toBe(0);
	});
});

describe("a leg deleted after a later balance update included it", () => {
	async function agree(userId: string, accountId: string, balance: string) {
		expect(await balanceOf(accountId)).toBe(balance);
		expect((await snapshotOn(accountId, TODAY)).balance.toString()).toBe(
			balance,
		);
		return {
			netWorth: await figureMinor(userId, "netWorth", "USD"),
			total: await figureMinor(userId, "netWorthChange.total", "USD"),
			notLogged: await figureMinor(userId, "netWorthChange.notLogged", "USD"),
			income: await figureMinor(userId, "netWorthChange.income", "USD"),
		};
	}

	it("income.delete: balance, snapshot series and netWorthChange all drop the income", async () => {
		const { user } = await createTestUser();
		const checking = await openAccount(
			user.id,
			"Checking",
			"CASH",
			"USD",
			1000,
		);
		const income = await forUser(user.id).apply(addIncome, {
			title: "Refund",
			amount: "100",
			currency: "USD",
			into: checking,
			date: isoDay(daysAgo(3)),
		});
		// The bank says 1,100: the update includes the income (Not logged 0).
		await forUser(user.id).apply(updateBalance, {
			accountId: checking,
			balance: "1100",
		});

		await forUser(user.id).apply(deleteIncome, {
			expenseId: income.value.expenseId,
		});

		// Opened ten days ago at 1,000; nothing else is left.
		expect(await agree(user.id, checking, "1000")).toEqual({
			netWorth: 100_000,
			total: 100_000,
			notLogged: 0,
			income: 0,
		});
	});

	it("transfer.delete: both accounts and their snapshots go back", async () => {
		const { user } = await createTestUser();
		const checking = await openAccount(
			user.id,
			"Checking",
			"CASH",
			"USD",
			1000,
		);
		const savings = await openAccount(user.id, "Savings", "CASH", "USD", 500);
		const transfer = await forUser(user.id).apply(createTransfer, {
			fromAccountId: checking,
			toAccountId: savings,
			fromAmount: "100",
			date: isoDay(daysAgo(3)),
		});
		await forUser(user.id).apply(updateBalance, {
			accountId: checking,
			balance: "900",
		});

		await forUser(user.id).apply(deleteTransfer, {
			transferId: transfer.value.transferId,
		});

		expect(await agree(user.id, checking, "1000")).toEqual({
			netWorth: 150_000,
			total: 150_000,
			notLogged: 0,
			income: 0,
		});
		expect(await balanceOf(savings)).toBe("500");
	});
});

describe("USD values follow the legs", () => {
	it("a zero snapshot that included a deleted leg gets a USD value at the account's rate", async () => {
		const { user } = await arsUser();
		const wallet = await openAccount(user.id, "Wallet", "CASH", "ARS", 1000);
		const income = await forUser(user.id).apply(addIncome, {
			title: "Refund",
			amount: "500",
			currency: "ARS",
			into: wallet,
			date: isoDay(daysAgo(3)),
		});
		await forUser(user.id).apply(updateBalance, {
			accountId: wallet,
			balance: "0",
		});

		await forUser(user.id).apply(deleteIncome, {
			expenseId: income.value.expenseId,
		});

		const opening = await snapshotOn(wallet, daysAgo(10));
		const today = await snapshotOn(wallet, TODAY);
		expect(today.balance.toString()).toBe("-500");
		// ARS -500 at the opening snapshot's USD per peso.
		expect(Number(today.balanceInUSD)).toBeCloseTo(
			(-500 * Number(opening.balanceInUSD)) / 1000,
			2,
		);
		expect(Number(today.balanceInUSD)).not.toBe(0);
	});

	it("the Wealth history counts legs on an account no rate values", async () => {
		const { user } = await createTestUser();
		const account = await adminDb.assetAccount.create({
			data: {
				userId: user.id,
				name: "Tokens",
				type: "CASH",
				currency: "ZZQ",
				balance: 100,
			},
		});
		await adminDb.assetSnapshot.create({
			data: {
				accountId: account.id,
				userId: user.id,
				date: daysAgo(10),
				recordedAt: daysAgo(10),
				balance: 100,
				balanceInUSD: 50,
				currency: "ZZQ",
				type: "CASH",
			},
		});
		await forUser(user.id).apply(createTransfer, {
			fromAccountId: null,
			fromCurrency: "ZZQ",
			toAccountId: account.id,
			fromAmount: "100",
			date: isoDay(daysAgo(3)),
		});

		const summary = await new WealthService(adminDb).getDashboardSummary(
			user.id,
			"USD",
		);

		// 200 units at the 0.50 USD the snapshot recorded per unit.
		const point = summary.history.find((h) => h.date === isoDay(daysAgo(3)));
		expect(point?.amount).toBeCloseTo(100, 2);
	});
});

describe("a transfer with a fee from one account", () => {
	it("shows that account once, from before both to after both, on create and delete", async () => {
		const { user } = await createTestUser();
		const checking = await openAccount(
			user.id,
			"Checking",
			"CASH",
			"USD",
			1000,
		);
		const savings = await openAccount(user.id, "Savings", "CASH", "USD", 0);
		const created = await forUser(user.id).apply(createTransfer, {
			fromAccountId: checking,
			toAccountId: savings,
			fromAmount: "100",
			fee: { amount: "2" },
		});
		const row = (rows: readonly { accountId: string }[], id: string) =>
			rows.filter((r) => r.accountId === id);
		expect(row(created.value.accounts, checking)).toEqual([
			expect.objectContaining({ before: "1000", after: "898" }),
		]);

		const deleted = await forUser(user.id).apply(deleteTransfer, {
			transferId: created.value.transferId,
		});

		expect(row(deleted.value.accounts, checking)).toEqual([
			expect.objectContaining({ before: "898", after: "1000" }),
		]);
		expect(deleted.value.accounts).toHaveLength(2);
	});
});

describe("checkpoints are dated by the user's day", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("a Tokyo user at 08:00 updates the balance and adds income on the same day", async () => {
		const { user } = await createTestUser();
		const checking = await openAccount(
			user.id,
			"Checking",
			"CASH",
			"USD",
			1000,
		);
		// 08:00 on Oct 22 in Tokyo is still Oct 21 in UTC.
		const at = new Date("2026-10-21T23:00:00.000Z");
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(at);
		const timeZone = "Asia/Tokyo";

		await forUser(user.id).apply(updateBalance, {
			accountId: checking,
			balance: "1200",
			timeZone,
		});
		await forUser(user.id).apply(addIncome, {
			title: "Refund",
			amount: "50",
			currency: "USD",
			into: checking,
			timeZone,
		});
		await editAccount(
			adminDb,
			user.id,
			checking,
			{
				name: "Checking",
				type: "CASH",
				currency: "USD",
				balance: 1300,
				isLiquid: true,
			},
			timeZone,
		);

		// The account's opening snapshot was recorded earlier, for its own day.
		const snapshots = await adminDb.assetSnapshot.findMany({
			where: { accountId: checking, recordedAt: at },
		});
		const legs = await adminDb.accountLeg.findMany({
			where: { accountId: checking },
		});
		expect(snapshots.map((s) => isoDay(s.date))).toEqual(["2026-10-22"]);
		expect([...new Set(legs.map((l) => isoDay(l.date)))]).toEqual([
			"2026-10-22",
		]);
	});
});

describe("an account with legs keeps its side of net worth", () => {
	it("refuses a change between something you have and something you owe", async () => {
		const { user } = await createTestUser();
		const checking = await openAccount(
			user.id,
			"Checking",
			"CASH",
			"USD",
			1000,
		);
		await forUser(user.id).apply(addIncome, {
			title: "Salary",
			amount: "100",
			currency: "USD",
			into: checking,
		});
		const fields = {
			name: "Checking",
			currency: "USD",
			balance: 1100,
			isLiquid: true,
		};

		await expect(
			editAccount(adminDb, user.id, checking, {
				...fields,
				type: "LIABILITY_LOAN",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		// Another kind on the same side is fine.
		await editAccount(adminDb, user.id, checking, {
			...fields,
			type: "INVESTMENT",
		});
		const account = await adminDb.assetAccount.findUniqueOrThrow({
			where: { id: checking },
		});
		expect(account.type).toBe("INVESTMENT");
	});
});

describe("undo puts back exactly what it took", () => {
	it("reverting an update restores the stored rate", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Savings", "CASH", "ARS", 900_000, {
			exchangeRateType: "official",
		});
		await adminDb.assetAccount.update({
			where: { id },
			data: { exchangeRate: 900 },
		});
		const { value } = await forUser(user.id).apply(updateBalance, {
			accountId: id,
			balance: "1412000",
		});
		expect(value.previousRate).toBe("900");

		await forUser(user.id).apply(revertBalanceUpdate, {
			accountId: id,
			legId: value.legId,
			rateTypeId: value.rateSwitch?.rateTypeId ?? null,
			previousRate: value.previousRate,
		});

		const account = await adminDb.assetAccount.findUniqueOrThrow({
			where: { id },
		});
		expect(account.balance.toString()).toBe("900000");
		expect(account.exchangeRate?.toString()).toBe("900");
		// 900,000 at the restored 900 per USD.
		expect(Number((await snapshotOn(id, TODAY)).balanceInUSD)).toBeCloseTo(
			1000,
			2,
		);
	});

	it("a revert with no rate to value the balance refuses instead of using 1", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Savings", "CASH", "ARS", 900_000);
		const { value } = await forUser(user.id).apply(updateBalance, {
			accountId: id,
			balance: "1000000",
		});

		await expect(
			forUser(user.id).apply(revertBalanceUpdate, {
				accountId: id,
				legId: value.legId,
				rateTypeId: null,
				previousRate: null,
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("undoing the first of two rate type switches on one day keeps the second", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Savings", "CASH", "ARS", 1_000_000, {
			exchangeRateType: "official",
		});
		const first = await forUser(user.id).apply(setRateType, {
			accountId: id,
			rateType: "blue",
		});
		const second = await forUser(user.id).apply(setRateType, {
			accountId: id,
			rateType: "mep",
		});
		const typeNow = async () =>
			(await adminDb.assetAccount.findUniqueOrThrow({ where: { id } }))
				.exchangeRateType;

		await forUser(user.id).apply(revertRateType, {
			rateTypeId: first.value.rateTypeId,
		});
		expect(await typeNow()).toBe("mep");
		expect(
			(await adminDb.assetRateType.findMany({ where: { accountId: id } })).map(
				(r) => r.type,
			),
		).toEqual(["mep"]);

		await forUser(user.id).apply(revertRateType, {
			rateTypeId: second.value.rateTypeId,
		});
		expect(await typeNow()).toBe("official");
	});

	it("Update balance records the type the account ends up with on its switch", async () => {
		const { user } = await arsUser();
		const id = await openAccount(user.id, "Savings", "CASH", "ARS", 1_000_000, {
			exchangeRateType: "official",
		});
		// ARS has no card rate: the account falls back to another type.
		const { value } = await forUser(user.id).apply(updateBalance, {
			accountId: id,
			balance: "1000000",
			rateType: "card",
		});

		const account = await adminDb.assetAccount.findUniqueOrThrow({
			where: { id },
		});
		const switches = await adminDb.assetRateType.findMany({
			where: { accountId: id },
		});
		expect(account.exchangeRateType).not.toBe("official");
		expect(switches.map((s) => s.type)).toEqual([account.exchangeRateType]);
		expect(value.rateSwitch?.rateType).toBe(account.exchangeRateType);
	});
});

describe("two opposite transfers at once", () => {
	it("queue on their accounts instead of deadlocking", async () => {
		const { user } = await createTestUser();
		const a = await openAccount(user.id, "A", "CASH", "USD", 1000);
		const b = await openAccount(user.id, "B", "CASH", "USD", 1000);
		const move = (from: string, to: string) =>
			forUser(user.id).apply(createTransfer, {
				fromAccountId: from,
				toAccountId: to,
				fromAmount: "10",
			});

		for (let round = 0; round < 5; round++) {
			await Promise.all([move(a, b), move(b, a)]);
		}

		expect(await balanceOf(a)).toBe("1000");
		expect(await balanceOf(b)).toBe("1000");
	});
});

describe("the net worth breakdown in one read", () => {
	it("loads the ledger once for the total and its seven parts", async () => {
		const { user } = await createTestUser();
		await openAccount(user.id, "Checking", "CASH", "USD", 1000);
		const ids = figures.ids.filter((id) => id.startsWith("netWorthChange."));
		expect(ids).toHaveLength(8);
		let loads = 0;

		const readings = await userTransaction(adminDb, user.id, (tx) => {
			const snapshots = new Proxy(tx.assetSnapshot, {
				get(target, key) {
					if (key === "findMany") {
						return (...args: Parameters<typeof target.findMany>) => {
							loads++;
							return target.findMany(...args);
						};
					}
					return Reflect.get(target, key);
				},
			});
			const counted = new Proxy(tx, {
				get: (target, key) =>
					key === "assetSnapshot" ? snapshots : Reflect.get(target, key),
			});
			return readFiguresIn(
				counted,
				ids.map((id) => figures.get(id)),
				{ userId: user.id },
			);
		});

		expect(loads).toBe(1);
		expect(readings.get("netWorthChange.total")).toEqual([usd(1000)]);
	});
});
