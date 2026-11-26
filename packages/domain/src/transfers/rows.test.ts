/**
 * The rows of a transfer on hand-built places. ARS home, Blue 1 USD = 1,545
 * ARS (the default pick), Official 1,050, JPY 150 per USD. Every expected
 * value is derived by hand in its comment; the same moves are pinned against
 * the database in services/transfers/transfers-characterization.pg.test.ts.
 */
import { describe, expect, it } from "vitest";
import { ratePickFromRows } from "../accounts/valuation";
import { MissingRateError } from "../money-dec";
import { NoArrivalRateError, TransferRefusal } from "./refusals";
import {
	TRANSFER_FEE_TEXT,
	type TransferAccount,
	type TransferRowsInput,
	transferRows,
} from "./rows";

const day = new Date("2026-03-10T00:00:00.000Z");
const rateDay = new Date("2026-03-09T00:00:00.000Z");
const pick = ratePickFromRows([
	{ currency: "ARS", type: "blue", rate: 1545, date: rateDay },
	{ currency: "ARS", type: "official", rate: 1050, date: rateDay },
	{ currency: "JPY", type: "official", rate: 150, date: rateDay },
]);

const account = (
	id: string,
	type: TransferAccount["type"],
	currency: string,
	extra: Partial<TransferAccount> = {},
): TransferAccount => ({
	id,
	type,
	currency,
	inBudget: null,
	countedUnits: "0",
	exchangeRateType: null,
	exchangeRate: null,
	...extra,
});

const savings = account("savings", "CASH", "ARS");
const wallet = account("wallet", "CASH", "ARS");
const loan = account("loan", "LIABILITY_LOAN", "ARS");
const usdBlue = account("usd-blue", "CASH", "USD", {
	exchangeRateType: "blue",
});
const usdOfficial = account("usd-official", "INVESTMENT", "USD", {
	exchangeRateType: "official",
});

const rows = (
	from: TransferAccount | null,
	to: TransferAccount | null,
	fromAmount: string,
	extra: Partial<TransferRowsInput> = {},
) =>
	transferRows({
		from: { account: from, currency: "ARS" },
		to: { account: to, currency: "ARS" },
		fromAmount,
		pick,
		homeCurrency: "ARS",
		date: day,
		timeZone: "America/Argentina/Buenos_Aires",
		ids: { transfer: "t-1", feeExpense: "fee-1" },
		...extra,
	});

const ars = (minor: number) => ({ minor, currency: "ARS" });

describe("an exchange with no typed amount arrives at the reference rate", () => {
	it("ARS 1,545,000 into a USD account at Blue: USD 1,000.00, net worth unchanged", () => {
		// 1,545,000 / 1,545 = 1,000. At Blue the USD leg books 1,000 x 1,545.
		const r = rows(savings, usdBlue, "1545000");
		expect(r.transfer).toMatchObject({
			id: "t-1",
			kind: "EXCHANGE",
			fromAmount: "1545000",
			toAmount: "1000",
			toCurrency: "USD",
			fromAccountId: "savings",
			toAccountId: "usd-blue",
			referenceRateType: "blue",
			note: null,
		});
		expect(r.legs.map((l) => l.amount.toString())).toEqual([
			"-1545000",
			"1000",
		]);
		expect(r.legs.map((l) => l.home?.amount.toString())).toEqual([
			"-1545000",
			"1545000",
		]);
		expect(r.netWorthEffect).toEqual(ars(0));
		expect(r.reference.vsReference).toEqual(ars(0));
		expect(r.rate).toEqual({ base: "USD", quote: "ARS", value: "1545.000000" });
		expect(r.fee).toBeNull();
	});

	it("into a USD account at Official it still arrives at USD 1,000.00 but books ARS 1,050,000", () => {
		// The reference ignores the account's type; the leg is valued at the
		// account's own: 1,000 x 1,050 = 1,050,000, so net worth moves
		// 1,050,000 - 1,545,000 = -495,000 (49,500,000 centavos).
		const r = rows(savings, usdOfficial, "1545000");
		expect(r.transfer.toAmount).toBe("1000");
		expect(r.legs[1].home?.amount.toString()).toBe("1050000");
		expect(r.netWorthEffect).toEqual(ars(-49_500_000));
		// Against the reference (Blue) the typed side is even: 0.
		expect(r.reference.vsReference).toEqual(ars(0));
		expect(r.reference.referenceRateType).toBe("blue");
	});

	it("typed USD 1,471.43 books 1,471.43 x 1,050 = ARS 1,545,001.50: net worth +1.50", () => {
		const r = rows(savings, usdOfficial, "1545000", { toAmount: "1471.43" });
		expect(r.transfer.toAmount).toBe("1471.43");
		expect(r.legs[1].home?.amount.toString()).toBe("1545001.5");
		expect(r.netWorthEffect).toEqual(ars(150));
		// More USD than the reference gave: 471.43 x 1,545 = 728,359.35 over it.
		expect(r.reference.vsReference).toEqual(ars(72_835_935));
		// 1,545,000 / 1,471.43 = 1,050 - 1.5 / 1,471.43 = 1,049.998980544...
		expect(r.rate?.value).toBe("1049.998981");
	});

	it("an arrival that lands on half a unit rounds half to even", () => {
		// ARS 25.75 x 150 / 1,545 = 2.5 JPY (0 decimals): half-even gives 2,
		// half-up would give 3. 15.45 gives 1.5, which both round to 2 (an odd neighbor).
		const tie = rows(savings, null, "25.75", {
			to: { account: null, currency: "JPY" },
		});
		expect(tie.transfer.toAmount).toBe("2");
		const odd = rows(savings, null, "15.45", {
			to: { account: null, currency: "JPY" },
		});
		expect(odd.transfer.toAmount).toBe("2");
	});
});

describe("a missing rate is an error, never 1", () => {
	it("an exchange into an unpriced currency with no typed amount refuses", () => {
		const attempt = () =>
			rows(savings, null, "1000", { to: { account: null, currency: "ZZZ" } });
		expect(attempt).toThrow(NoArrivalRateError);
		expect(attempt).toThrow(MissingRateError);
		expect(attempt).toThrow(
			"No exchange rate for ARS to ZZZ. Type what arrived.",
		);
	});

	it("a typed arrival into an unpriced currency books no home value", () => {
		const r = rows(savings, null, "1000", {
			to: { account: null, currency: "ZZZ" },
			toAmount: "5",
		});
		expect(r.legs[1].home).toBeNull();
		expect(r.netWorthEffect).toBeNull();
		expect(r.reference.vsReference).toBeNull();
	});
});

describe("the places", () => {
	it("no account and no currency refuses, and so does a malformed currency", () => {
		for (const currency of [null, undefined, "", "us", "USD$"]) {
			expect(() =>
				rows(savings, null, "10", { to: { account: null, currency } }),
			).toThrow(
				"Pick an account or the currency of the money that is not tracked",
			);
		}
		expect(() =>
			rows(null, null, "10", { to: { account: null, currency: null } }),
		).toThrow(TransferRefusal);
	});

	it("an account's own currency wins over the one given", () => {
		const r = rows(savings, usdBlue, "1545000", {
			to: { account: usdBlue, currency: "EUR" },
		});
		expect(r.transfer.toCurrency).toBe("USD");
	});

	it("a withdrawal into Not tracked leaves the budget nowhere: net worth and budget unchanged", () => {
		const r = rows(wallet, null, "100000", { kind: "WITHDRAWAL" });
		expect(r.transfer).toMatchObject({
			kind: "WITHDRAWAL",
			toAccountId: null,
			toCurrency: "ARS",
		});
		expect(r.legs[1]).toMatchObject({ accountId: null, currency: "ARS" });
		expect(r.legs[1].home?.amount.toString()).toBe("100000");
		expect(r.netWorthEffect).toEqual(ars(0));
		// Not tracked is in the budget in the home currency, like the wallet.
		expect(r.budget).toEqual({ effect: "none" });
	});

	it("a debt payment keeps net worth and leaves the budget by what was paid", () => {
		const r = rows(savings, loan, "50000");
		expect(r.transfer.kind).toBe("DEBT_PAYMENT");
		expect(r.legs.map((l) => l.amount.toString())).toEqual(["-50000", "50000"]);
		expect(r.netWorthEffect).toEqual(ars(0));
		// A loan is outside the budget: 50,000 pesos leave it (5,000,000 centavos).
		expect(r.budget).toEqual({
			effect: "leaves",
			minor: 5_000_000,
			currency: "ARS",
		});
		expect(r.budgetAccountId).toBe("loan");
	});

	it("a plain move between two places in the budget changes nothing there", () => {
		const r = rows(savings, wallet, "300000");
		expect(r.budget).toEqual({ effect: "none" });
		expect(r.countedMoves).toEqual([]);
		expect(
			r.legs.every((l) => l.source === "TRANSFER" && l.transferId === "t-1"),
		).toBe(true);
		expect(r.legs.every((l) => l.date === day)).toBe(true);
	});
});

describe("the fee", () => {
	it("is an OUT expense in the viewer's zone and a FEE leg on the source", () => {
		const r = rows(savings, wallet, "100000", { fee: { amount: "150" } });
		// The expense sits at Buenos Aires midnight of March 10: 03:00Z.
		expect(r.fee?.expense).toEqual({
			id: "fee-1",
			title: TRANSFER_FEE_TEXT.title,
			description: TRANSFER_FEE_TEXT.description,
			amount: "150",
			currency: "ARS",
			date: new Date("2026-03-10T03:00:00.000Z"),
		});
		expect(TRANSFER_FEE_TEXT).toEqual({
			title: "Fee",
			description: "Fee for a transfer",
		});
		expect(r.fee?.leg).toMatchObject({
			accountId: "savings",
			currency: "ARS",
			source: "FEE",
			transferId: "t-1",
			expenseId: "fee-1",
			date: day,
		});
		expect(r.fee?.leg.amount.toString()).toBe("-150");
		// The move nets to zero; the fee alone moves net worth: -150.00.
		expect(r.netWorthEffect).toEqual(ars(-15_000));
	});

	it("comes from another account when one is given, in that account's currency", () => {
		const r = rows(savings, wallet, "100000", {
			fee: { amount: "2.5", account: usdBlue },
		});
		// USD 2.50 at Blue = ARS 3,862.50 out of net worth.
		expect(r.fee?.leg).toMatchObject({
			accountId: "usd-blue",
			currency: "USD",
		});
		expect(r.fee?.leg.home?.amount.toString()).toBe("-3862.5");
		expect(r.netWorthEffect).toEqual(ars(-386_250));
	});

	it("a zero fee books nothing, and a fee over its currency's decimals refuses", () => {
		expect(
			rows(savings, wallet, "100000", { fee: { amount: "0" } }).fee,
		).toBeNull();
		expect(() =>
			rows(savings, wallet, "100000", { fee: { amount: "1.234" } }),
		).toThrow("ARS has 2 decimals");
	});
});

describe("counted units (D4)", () => {
	const wise = (counted: string) =>
		account("wise", "INVESTMENT", "USD", { countedUnits: counted });
	const usdCash = account("usd-cash", "CASH", "USD", { inBudget: false });
	const usd = (from: TransferAccount, to: TransferAccount, amount: string) =>
		transferRows({
			from: { account: from },
			to: { account: to },
			fromAmount: amount,
			pick,
			homeCurrency: "ARS",
			date: day,
			ids: { transfer: "t-1", feeExpense: "fee-1" },
		});

	it("counted units leave the source and follow the money to another place outside the budget", () => {
		// Wise holds 30 counted of the USD 50 sent: all 30 move, 50 x 30 / 50 = 30.
		const r = usd(wise("30"), usdCash, "50");
		expect(r.transfer).toMatchObject({
			countedFromUnits: "30",
			countedToUnits: "30",
		});
		expect(
			r.countedMoves.map((m) => [m.accountId, m.delta.toString()]),
		).toEqual([
			["wise", "-30"],
			["usd-cash", "30"],
		]);
		// Neither place is in the budget: it does not move.
		expect(r.budget).toEqual({ effect: "none" });
	});

	it("never more than the amount sent leaves", () => {
		const r = usd(wise("80"), usdCash, "50");
		expect(r.transfer.countedFromUnits).toBe("50");
		expect(r.countedMoves[0]?.delta.toString()).toBe("-50");
	});

	it("nothing counted, nothing moves", () => {
		const r = usd(wise("0"), usdCash, "50");
		expect(r.countedMoves).toEqual([]);
	});

	it("all of it counted already: nothing fresh enters the budget", () => {
		const r = transferRows({
			from: { account: wise("50") },
			to: { account: wallet },
			fromAmount: "50",
			toAmount: "77250",
			pick,
			homeCurrency: "ARS",
			date: day,
			ids: { transfer: "t-1", feeExpense: "fee-1" },
		});
		expect(r.budget).toEqual({ effect: "counted" });
		expect(r.budgetAccountId).toBe("wise");
	});
});
