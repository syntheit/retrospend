/**
 * One home value per account on real Postgres (PR 4c of
 * docs/roadmap/money-decimal.md): the Wealth dashboard row and total, the
 * registered netWorth figure, API v1 accounts items (mobile) and the v1 net
 * worth all read accounts/valuation.ts, so they agree on every value.
 *
 * Rates per USD, official: EUR 3, GBP 7, JPY 16.5; ARS blue 1,545; BTC 60,000
 * USD per coin.
 *
 * JPY home: 1 EUR is 16.5 / 3 = 5.5 JPY, a tie, so 6 (half to even; the old
 * two divisions gave 5 on the other readers). 1.2 EUR is 6.6, no tie: 7.
 *
 * ARS home, one user:
 * - Bitcoin 0.01234567 x 60,000 x 1,545 = 1,144,443.609 (.61 on its row).
 * - Euro 0.001 / 3 x 1,545 = 0.515 exactly, a tie on cents: 0.52 (51.5 -> 52).
 * - Pound 3 x 1,545 / 7 = 662.142857142857...: 662.14.
 * Net worth = 1,144,443.609 + 0.515 + 662.142857142857 = 1,145,106.266857...,
 * rounded once: 1,145,106.27 (114,510,627 minor).
 *
 * Stored values do not move: the Pound leg of a 3 GBP move out is worth
 * 3 x 1,545 / 7 = 662.14285714 (8 dp, as written before), and 1,545 ARS of
 * income into the Pound account lands as 1,545 / (1,545 / 7) = 7 GBP.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { readFigures } from "~/server/figures/read";
import { accountItemsIn } from "~/server/services/api-v1/accounts/items";
import { netWorthIn } from "~/server/services/api-v1/accounts/net-worth";
import { addIncome } from "~/server/services/income/add.mutation";
import { forUser } from "~/server/services/preview";
import { createTransfer } from "~/server/services/transfers/create.mutation";
import { WealthService } from "~/server/services/wealth.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { openAccount, TODAY, TODAY_ZONE } from "./test-fixtures";

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

async function seedRates() {
	for (const [currency, type, rate] of [
		["EUR", "official", "3"],
		["GBP", "official", "7"],
		["JPY", "official", "16.5"],
		["ARS", "blue", "1545"],
		["BTC", "crypto", "60000"],
	] as const) {
		await adminDb.exchangeRate.upsert({
			where: { date_currency_type: { date: TODAY, currency, type } },
			create: { date: TODAY, currency, type, rate },
			update: { rate },
		});
	}
}

async function userAt(homeCurrency: string): Promise<TestUser> {
	const u = await createTestUser();
	await adminDb.user.update({
		where: { id: u.user.id },
		data: { homeCurrency, timeZone: TODAY_ZONE },
	});
	return u;
}

/** Every reader of an account's home value, for one user. */
async function readers(u: TestUser, home: string) {
	const userId = u.user.id;
	const dashboard = await new WealthService(u.db).getDashboardSummary(
		userId,
		home,
	);
	const figure = (await readFigures(userId, ["netWorth"])).get("netWorth");
	const { items, worth } = await userTransaction(
		adminDb,
		userId,
		async (tx) => ({
			items: (await accountItemsIn(tx, userId)).accounts,
			worth: await netWorthIn(tx, userId, { days: 1, changeDays: 30 }),
		}),
	);
	return { dashboard, figure, items, worth };
}

let tie: TestUser;
let control: TestUser;
let ars: TestUser;
let pound: string;

beforeAll(async () => {
	await seedRates();
	tie = await userAt("JPY");
	await openAccount(tie.user.id, "Euro", "CASH", "EUR", 1);
	control = await userAt("JPY");
	await openAccount(control.user.id, "Euro", "CASH", "EUR", 1.2);
	ars = await userAt("ARS");
	await openAccount(ars.user.id, "Bitcoin", "CRYPTO", "BTC", 0.01234567);
	await openAccount(ars.user.id, "Euro", "CASH", "EUR", 0.001);
	pound = await openAccount(ars.user.id, "Pound", "CASH", "GBP", 3);
});

describe("a JPY home: 1 EUR at 3 per USD into JPY at 16.5", () => {
	it("is 5.5 JPY exactly, so 6 on every reader", async () => {
		const r = await readers(tie, "JPY");

		expect(r.dashboard.assets[0]?.balanceInTargetCurrency).toBe(6);
		expect(r.dashboard.totalNetWorth).toBe(6);
		expect(r.figure).toEqual([{ minor: 6, currency: "JPY" }]);
		expect(r.items[0]?.value).toEqual({ minor: 6, currency: "JPY" });
		expect(r.worth.netWorth).toEqual({ minor: 6, currency: "JPY" });
		expect(r.worth.series.at(-1)?.value).toEqual({
			minor: 6,
			currency: "JPY",
		});
	});

	it("a non-tie control, 1.2 EUR = 6.6 JPY, is 7 on every reader", async () => {
		const r = await readers(control, "JPY");

		expect(r.dashboard.assets[0]?.balanceInTargetCurrency).toBe(7);
		expect(r.dashboard.totalNetWorth).toBe(7);
		expect(r.figure).toEqual([{ minor: 7, currency: "JPY" }]);
		expect(r.items[0]?.value).toEqual({ minor: 7, currency: "JPY" });
		expect(r.worth.netWorth).toEqual({ minor: 7, currency: "JPY" });
	});
});

describe("an ARS home with a coin, a tie and a repeating rate", () => {
	it("every reader prices each account the same", async () => {
		const r = await readers(ars, "ARS");
		const row = (name: string) =>
			r.dashboard.assets.find((a) => a.name === name);
		const item = (name: string) => r.items.find((a) => a.name === name);

		expect(row("Bitcoin")?.balanceInTargetCurrency).toBe(1_144_443.61);
		expect(item("Bitcoin")?.value).toEqual({
			minor: 114_444_361,
			currency: "ARS",
		});
		expect(row("Euro")?.balanceInTargetCurrency).toBe(0.52);
		expect(item("Euro")?.value).toEqual({ minor: 52, currency: "ARS" });
		expect(row("Pound")?.balanceInTargetCurrency).toBe(662.14);
		expect(item("Pound")?.value).toEqual({ minor: 66_214, currency: "ARS" });
		// 1,545 / 7 at twelve decimals, as the app has always shown it.
		expect(item("Pound")?.rate).toBe("220.714285714286");
	});

	it("the total adds the exact values and rounds once, on every reader", async () => {
		const r = await readers(ars, "ARS");
		const total = { minor: 114_510_627, currency: "ARS" };

		expect(r.dashboard.totalNetWorth).toBe(1_145_106.27);
		expect(r.figure).toEqual([total]);
		expect(r.worth.netWorth).toEqual(total);
	});
});

describe("what a writer stores does not move", () => {
	it("a leg's home value and an income's units match the per-unit quotient as before", async () => {
		const run = forUser(ars.user.id);
		await run.apply(addIncome, {
			title: "Bonus",
			amount: "1545",
			currency: "ARS",
			into: pound,
		});
		await run.apply(createTransfer, {
			fromAccountId: pound,
			toAccountId: null,
			toCurrency: "GBP",
			fromAmount: "3",
		});

		const legs = await adminDb.accountLeg.findMany({
			where: { userId: ars.user.id, accountId: pound },
			orderBy: { createdAt: "asc" },
		});
		// 1,545 / (1,545 / 7) = 7 GBP in; 3 GBP out is -662.14285714 ARS at home.
		const income = legs.find((l) => l.source === "INCOME");
		const out = legs.find((l) => l.source === "TRANSFER");
		expect(income?.amount.toString()).toBe("7");
		expect(out?.amount.toString()).toBe("-3");
		expect(out?.homeAmount?.toString()).toBe("-662.14285714");
		expect(out?.homeCurrency).toBe("ARS");
	});
});
