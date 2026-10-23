/**
 * Net worth and why it moved (I10), end to end on real Postgres. One user,
 * ARS home, rates ARS 1,468 Blue, 1,412 Official, 1,449 MEP per USD.
 *
 * Opened ten days ago: Digital wallet ARS 1,000,000, Wise USD 1,840.55
 * valued at Official, Old cash ARS 5,000. Then today:
 * 1. Freelance USD 2,000 at MEP kept in Wise: income +2,898,000, Wise
 *    values it at Official (2,824,000), so revaluation -74,000.
 * 2. Exchange ARS 442,500 from the wallet into Wise for USD 300 (worth
 *    423,600 at Official): exchange -18,900.
 * 3. Update balance: the wallet shows 557,500, the bank says 550,000:
 *    Not logged -7,500.
 * 4. ARS 10,000 from the wallet into Not tracked cash, fee ARS 500:
 *    exchange 0, spending -500.
 * 5. Close Old cash: closed -5,000.
 * Net worth = Wise 4,140.55 x 1,412 + wallet 539,500 + Not tracked 10,000
 *           = 5,846,456.60 + 539,500 + 10,000 = ARS 6,395,956.60.
 * Nothing existed 30 days ago, so the change is the whole of it:
 * opened 3,603,856.60 + 2,898,000 - 74,000 - 18,900 - 7,500 - 500 - 5,000.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { addIncome } from "~/server/services/income/add.mutation";
import { forUser } from "~/server/services/preview";
import { createTransfer } from "~/server/services/transfers/create.mutation";
import { adminDb } from "~/test/pg-harness";
import { closeAccount } from "./manage";
import { CHANGE_PARTS } from "./net-worth-change";
import {
	arsUser,
	figure,
	figureMinor,
	openAccount,
	seedArsRates,
} from "./test-fixtures";
import { updateBalance } from "./update-balance.mutation";

let userId: string;
let wise: string;

beforeAll(async () => {
	await seedArsRates();
	userId = (await arsUser()).user.id;
	const wallet = await openAccount(
		userId,
		"Digital wallet",
		"CASH",
		"ARS",
		1_000_000,
	);
	wise = await openAccount(userId, "Wise", "INVESTMENT", "USD", 1840.55, {
		exchangeRateType: "official",
	});
	const oldCash = await openAccount(userId, "Old cash", "CASH", "ARS", 5000);
	const run = forUser(userId);
	await run.apply(addIncome, {
		title: "Estudio Norte",
		amount: "2000",
		currency: "USD",
		rateType: "mep",
		into: wise,
	});
	await run.apply(createTransfer, {
		fromAccountId: wallet,
		toAccountId: wise,
		fromAmount: "442500",
		toAmount: "300",
	});
	await run.apply(updateBalance, { accountId: wallet, balance: "550000" });
	await run.apply(createTransfer, {
		fromAccountId: wallet,
		toAccountId: null,
		toCurrency: "ARS",
		fromAmount: "10000",
		fee: { amount: "500" },
	});
	await closeAccount(adminDb, userId, oldCash);
});

const PARTS = {
	opened: 360_385_660,
	income: 289_800_000,
	revaluation: -7_400_000,
	exchange: -1_890_000,
	notLogged: -750_000,
	spending: -50_000,
	closed: -500_000,
};

describe("figure netWorth", () => {
	it("is open accounts at their own rate types plus Not tracked and Owed", async () => {
		expect(await figureMinor(userId, "netWorth")).toBe(639_595_660);
	});
});

describe("figure netWorthChange.total", () => {
	it("I10 net worth moves only for named reasons: the parts add up to the change", async () => {
		const total = await figureMinor(userId, "netWorthChange.total");
		const parts = await Promise.all(
			CHANGE_PARTS.map((p) => figureMinor(userId, `netWorthChange.${p}`)),
		);
		expect(total).toBe(639_595_660);
		expect(parts.reduce((t: number, v) => t + (v ?? 0), 0)).toBe(total);
	});
});

describe("figure netWorthChange.income", () => {
	it("is the income booked at its own rate (MEP), not the account's", async () => {
		expect(await figureMinor(userId, "netWorthChange.income")).toBe(
			PARTS.income,
		);
	});
});

describe("figure netWorthChange.revaluation", () => {
	it("is Wise valuing the MEP dollars at Official", async () => {
		expect(await figureMinor(userId, "netWorthChange.revaluation")).toBe(
			PARTS.revaluation,
		);
	});
});

describe("figure netWorthChange.exchange", () => {
	it("is what the exchange cost against the account's rate", async () => {
		expect(await figureMinor(userId, "netWorthChange.exchange")).toBe(
			PARTS.exchange,
		);
	});
});

describe("figure netWorthChange.notLogged", () => {
	it("is the balance update's difference from what was recorded", async () => {
		expect(await figureMinor(userId, "netWorthChange.notLogged")).toBe(
			PARTS.notLogged,
		);
	});
});

describe("figure netWorthChange.spending", () => {
	it("is the fee paid from an account", async () => {
		expect(await figureMinor(userId, "netWorthChange.spending")).toBe(
			PARTS.spending,
		);
	});
});

describe("figure netWorthChange.opened", () => {
	it("is the first balance of accounts added in the span", async () => {
		expect(await figureMinor(userId, "netWorthChange.opened")).toBe(
			PARTS.opened,
		);
	});
});

describe("figure netWorthChange.closed", () => {
	it("is what closed accounts held", async () => {
		expect(await figureMinor(userId, "netWorthChange.closed")).toBe(
			PARTS.closed,
		);
	});
});

describe("figure accounts.balance", () => {
	it("is what open accounts hold per currency, or one account narrowed", async () => {
		expect(await figure(userId, "accounts.balance")).toEqual([
			{ minor: 53_950_000, currency: "ARS" },
			{ minor: 414_055, currency: "USD" },
		]);
		expect(await figure(userId, "accounts.balance", wise)).toEqual([
			{ minor: 414_055, currency: "USD" },
		]);
	});
});

describe("figure notTracked", () => {
	it("is the cash side of moves with no account, per currency", async () => {
		expect(await figure(userId, "notTracked")).toEqual([
			{ minor: 1_000_000, currency: "ARS" },
		]);
	});
});
