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
 * Stored values are unchanged except on exact ties, which now round half to
 * even (the per-unit rate is one exact division, no longer two 40 digit ones
 * that fell just under a tie). Off a tie: the Pound leg of a 3 GBP move out
 * is worth 3 x 1,545 / 7 = 662.14285714 (8 dp), and 1,545 ARS of income into
 * the Pound account lands as 1,545 / (1,545 / 7) = 7 GBP.
 *
 * On a tie (JPY home, the old value in brackets):
 * - Transfer 1 EUR into a JPY account at the reference rate: 16.5 / 3 = 5.5,
 *   so 6 JPY arrive (5).
 * - Transfer out 0.01 CHF at 192 per USD: 16.5 / 192 = 0.0859375 JPY per CHF,
 *   0.01 x 0.0859375 = 0.000859375 exactly; at 8 dp that is a tie between
 *   ...37 (odd) and ...38, so the leg is worth -0.00085938 (-0.00085937).
 * - The 12 dp rate of a SEK account at 12,288 per USD: 16.5 / 12,288 =
 *   0.0013427734375 exactly, a tie between ...437 (odd) and ...438:
 *   0.001342773438 (0.001342773437).
 *
 * Rates that do not terminate (an amount times the 40 digit quotient lands
 * just under the tie, one division lands on it):
 * - Transfer 3 NOK (9 per USD) into a JPY account: per unit 16.5 / 9 =
 *   1.8333..., 3 x 16.5 / 9 = 5.5 exactly, so 6 JPY arrive. 3 x 1.8333...3
 *   (40 digits) is 5.4999...9, which would give 5.
 * - Transfer out 0.036 KWD at 768 per USD, home USD: 0.036 / 768 =
 *   0.000046875 exactly (3 / 64,000), a tie between ...87 (odd) and ...88:
 *   -0.00004688. 0.036 x (1 / 768) lands on the other side: -0.00004687.
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
		["CHF", "official", "192"],
		["SEK", "official", "12288"],
		["NOK", "official", "9"],
		["KWD", "official", "768"],
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
let ties: TestUser;
let ex: { eur: string; yen: string; chf: string; nok: string; yen2: string };
let usdTies: TestUser;
let kuwait: string;

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
	ties = await userAt("JPY");
	ex = {
		eur: await openAccount(ties.user.id, "Euro", "CASH", "EUR", 10),
		yen: await openAccount(ties.user.id, "Yen", "CASH", "JPY", 100),
		chf: await openAccount(ties.user.id, "Franc", "CASH", "CHF", 1),
		nok: "",
		yen2: "",
	};
	await openAccount(ties.user.id, "Krona", "CASH", "SEK", 1);
	ex.nok = await openAccount(ties.user.id, "Krone", "CASH", "NOK", 10);
	ex.yen2 = await openAccount(ties.user.id, "Yen two", "CASH", "JPY", 100);
	usdTies = await userAt("USD");
	kuwait = await openAccount(usdTies.user.id, "Dinar", "CASH", "KWD", 1);
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

describe("what a writer stores is unchanged off a tie", () => {
	it("a leg's home value and an income's units match the per-unit quotient", async () => {
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

describe("what a writer stores on an exact tie rounds half to even", () => {
	const legsOf = (accountId: string) =>
		adminDb.accountLeg.findMany({
			where: { userId: ties.user.id, accountId },
			orderBy: { createdAt: "asc" },
		});

	it("a transfer arrives 6 JPY for 1 EUR at the reference rate (5.5), not 5", async () => {
		await forUser(ties.user.id).apply(createTransfer, {
			fromAccountId: ex.eur,
			toAccountId: ex.yen,
			fromAmount: "1",
		});

		const [arrived] = (await legsOf(ex.yen)).filter(
			(l) => l.source === "TRANSFER",
		);
		expect(arrived?.amount.toString()).toBe("6");
		// The EUR side is worth 5.5 JPY at home, which fits 8 dp exactly.
		const [left] = await legsOf(ex.eur);
		expect(left?.homeAmount?.toString()).toBe("-5.5");
	});

	it("an 8 dp leg value ties to even: 0.01 CHF is -0.00085938 JPY, not -0.00085937", async () => {
		await forUser(ties.user.id).apply(createTransfer, {
			fromAccountId: ex.chf,
			toAccountId: null,
			toCurrency: "CHF",
			fromAmount: "0.01",
		});

		const [out] = (await legsOf(ex.chf)).filter((l) => l.source === "TRANSFER");
		expect(out?.amount.toString()).toBe("-0.01");
		expect(out?.homeAmount?.toString()).toBe("-0.00085938");
	});

	it("the 12 dp rate of API v1 ties to even: 0.001342773438, not ...437", async () => {
		const { accounts } = await userTransaction(adminDb, ties.user.id, (tx) =>
			accountItemsIn(tx, ties.user.id),
		);

		expect(accounts.find((a) => a.name === "Krona")?.rate).toBe(
			"0.001342773438",
		);
	});
});

describe("an exact tie where the per-unit rate does not terminate", () => {
	it("a transfer of 3 NOK arrives 6 JPY (3 x 16.5 / 9 = 5.5), one division", async () => {
		await forUser(ties.user.id).apply(createTransfer, {
			fromAccountId: ex.nok,
			toAccountId: ex.yen2,
			fromAmount: "3",
		});

		const [arrived] = await adminDb.accountLeg.findMany({
			where: { userId: ties.user.id, accountId: ex.yen2, source: "TRANSFER" },
		});
		expect(arrived?.amount.toString()).toBe("6");
	});

	it("an 8 dp leg value of 0.036 KWD at 768 per USD is -0.00004688 USD (0.000046875 exactly)", async () => {
		await forUser(usdTies.user.id).apply(createTransfer, {
			fromAccountId: kuwait,
			toAccountId: null,
			toCurrency: "KWD",
			fromAmount: "0.036",
		});

		const [out] = await adminDb.accountLeg.findMany({
			where: { userId: usdTies.user.id, accountId: kuwait, source: "TRANSFER" },
		});
		expect(out?.homeAmount?.toString()).toBe("-0.00004688");
	});
});
