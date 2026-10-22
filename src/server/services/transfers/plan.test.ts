/**
 * Transfer rules on hand-built places (MONEY-MOVES §2.3 to §2.7, D4). ARS
 * home. Accounts: Savings and Digital wallet (ARS bank, in the budget),
 * Credit card (in), Personal loan (out), USD cash and Wise (USD, out).
 */
import { describe, expect, it } from "vitest";
import { dec } from "~/server/services/envelope/units";
import type { AssetType } from "~prisma";
import {
	budgetEffect,
	derivedRate,
	type PlaceFacts,
	planTransfer,
	resolveKind,
	type TransferPlanInput,
	typedAmount,
} from "./plan";

const place = (
	id: string,
	type: AssetType,
	currency: string,
	counted = "0",
	inBudget: boolean | null = null,
): PlaceFacts => ({ id, type, currency, inBudget, countedUnits: dec(counted) });

const savings = place("savings", "CASH", "ARS");
const wallet = place("wallet", "CASH", "ARS");
const card = place("card", "LIABILITY_CREDIT_CARD", "ARS");
const loan = place("loan", "LIABILITY_LOAN", "ARS");
const usdCash = place("usd-cash", "CASH", "USD");
const wise = (counted = "0") => place("wise", "INVESTMENT", "USD", counted);

const move = (
	from: PlaceFacts | null,
	to: PlaceFacts | null,
	fromAmount: string,
	toAmount = fromAmount,
	extra: Partial<TransferPlanInput> = {},
): TransferPlanInput => ({
	from,
	to,
	fromCurrency: from?.currency ?? extra.fromCurrency ?? "ARS",
	toCurrency: to?.currency ?? extra.toCurrency ?? from?.currency ?? "ARS",
	fromAmount: dec(fromAmount),
	toAmount: dec(toAmount),
	homeCurrency: "ARS",
	...extra,
});

describe("transfer kinds (all 5)", () => {
	it("one currency between accounts is a transfer", () => {
		expect(resolveKind(move(savings, wallet, "300000"))).toBe("TRANSFER");
	});
	it("two currencies is an exchange", () => {
		expect(resolveKind(move(wallet, usdCash, "442500", "300"))).toBe(
			"EXCHANGE",
		);
	});
	it("into a credit card is a card payment", () => {
		expect(resolveKind(move(savings, card, "842600"))).toBe("CARD_PAYMENT");
	});
	it("into a loan is a debt payment", () => {
		expect(resolveKind(move(savings, loan, "50000"))).toBe("DEBT_PAYMENT");
	});
	it("cash out of an account into Not tracked is a withdrawal when asked", () => {
		expect(
			resolveKind(
				move(wallet, null, "100000", "100000", { requestedKind: "WITHDRAWAL" }),
			),
		).toBe("WITHDRAWAL");
	});
	it("refuses a kind the places do not fit", () => {
		expect(() =>
			resolveKind(
				move(savings, wallet, "1", "1", { requestedKind: "CARD_PAYMENT" }),
			),
		).toThrow(/credit card/);
		expect(() =>
			resolveKind(
				move(wallet, usdCash, "1", "1", { requestedKind: "TRANSFER" }),
			),
		).toThrow(/exchange/);
		expect(() => resolveKind(move(savings, savings, "1"))).toThrow(
			/two different/,
		);
		expect(() => resolveKind(move(null, null, "1"))).toThrow(/at least one/);
	});
});

describe("budget line", () => {
	const booked = (fromHome: string, toHome: string) => ({
		fromHome: dec(fromHome),
		toHome: dec(toHome),
	});

	it("I14 same side, no budget: both in the budget changes nothing", () => {
		const input = move(savings, card, "842600");
		expect(
			budgetEffect(input, planTransfer(input), booked("-842600", "842600")),
		).toEqual({
			effect: "none",
		});
	});

	it("I14 same side, no budget: both out of the budget changes nothing", () => {
		const input = move(usdCash, wise(), "100");
		expect(
			budgetEffect(input, planTransfer(input), booked("-146800", "141200")),
		).toEqual({
			effect: "none",
		});
	});

	it("I15 crossing moves the budget by the in-budget leg as typed (buy USD 300 for ARS 442,500)", () => {
		const input = move(wallet, usdCash, "442500", "300");
		expect(
			budgetEffect(input, planTransfer(input), booked("-442500", "440400")),
		).toEqual({
			effect: "leaves",
			minor: 44_250_000,
			currency: "ARS",
		});
	});

	it("I15 selling USD 1,000 from Wise for ARS 1,460,000 enters the budget by the pesos received", () => {
		const input = move(wise(), wallet, "1000", "1460000");
		expect(
			budgetEffect(input, planTransfer(input), booked("-1412000", "1460000")),
		).toEqual({
			effect: "enters",
			minor: 146_000_000,
			currency: "ARS",
		});
	});

	it("D4 counted units leave first and never enter twice", () => {
		const input = move(wise("400"), wallet, "1000", "1460000");
		const plan = planTransfer(input);
		expect(plan.countedFromUnits.toString()).toBe("400");
		expect(plan.freshUnits.toString()).toBe("600");
		// Only 600 of the 1,000 dollars are fresh: 1,460,000 x 0.6 = 876,000.
		expect(budgetEffect(input, plan, booked("-1412000", "1460000"))).toEqual({
			effect: "enters",
			minor: 87_600_000,
			currency: "ARS",
		});
	});

	it("D4 all counted: the budget does not move", () => {
		const input = move(wise("2000"), wallet, "1000", "1460000");
		expect(
			budgetEffect(input, planTransfer(input), booked("-1412000", "1460000")),
		).toEqual({
			effect: "counted",
		});
	});

	it("D4 counted units follow the money to another account outside the budget", () => {
		const plan = planTransfer(move(wise("400"), usdCash, "1000"));
		expect(plan.countedFromUnits.toString()).toBe("400");
		expect(plan.countedToUnits.toString()).toBe("400");
	});

	it("Not tracked pesos are in the budget, Not tracked dollars are not", () => {
		const out = move(wallet, null, "100000", "100000", {
			requestedKind: "WITHDRAWAL",
		});
		expect(
			budgetEffect(out, planTransfer(out), booked("-100000", "100000")),
		).toEqual({
			effect: "none",
		});
		const dollars = move(null, usdCash, "300", "300", { fromCurrency: "USD" });
		expect(
			budgetEffect(dollars, planTransfer(dollars), booked("-440400", "440400")),
		).toEqual({
			effect: "none",
		});
	});
});

describe("typed amounts (I21)", () => {
	it("I21 typed amounts win: the rate is derived from them", () => {
		expect(derivedRate(move(wallet, usdCash, "442500", "300"))).toEqual({
			base: "USD",
			quote: "ARS",
			value: "1475.000000",
		});
		expect(derivedRate(move(wise(), wallet, "1000", "1460000"))?.value).toBe(
			"1460.000000",
		);
		expect(derivedRate(move(savings, wallet, "1"))).toBeNull();
	});

	it("a one-currency move has one amount", () => {
		expect(() => planTransfer(move(savings, wallet, "100", "101"))).toThrow(
			/one amount/,
		);
	});

	it("amounts must fit their currency", () => {
		expect(typedAmount("442500", "ARS").toString()).toBe("442500");
		expect(() => typedAmount("1.234", "USD")).toThrow(/2 decimals/);
		expect(() => typedAmount("abc", "USD")).toThrow(/valid amount/);
		expect(() => planTransfer(move(savings, wallet, "0"))).toThrow(
			/above zero/,
		);
	});
});
