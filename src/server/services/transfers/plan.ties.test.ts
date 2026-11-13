/**
 * Half-even ties in the transfer plan, pinned before and after the plan moved
 * to the domain Decimal (money-decimal PR 6a). ARS home. Every expected value
 * is derived by hand in its comment.
 */
import { describe, expect, it } from "vitest";
import { dec } from "~/server/services/envelope/units";
import type { AssetType } from "~prisma";
import {
	budgetEffect,
	derivedRate,
	type PlaceFacts,
	planTransfer,
	type TransferPlanInput,
} from "./plan";

const place = (
	id: string,
	type: AssetType,
	currency: string,
	counted = "0",
): PlaceFacts => ({
	id,
	type,
	currency,
	inBudget: null,
	countedUnits: dec(counted),
});

const wise = (counted: string) => place("wise", "INVESTMENT", "USD", counted);
const eurCash = place("eur", "CASH", "EUR");
const usdCash = place("usd", "CASH", "USD");
const wallet = place("wallet", "CASH", "ARS");

const move = (
	from: PlaceFacts,
	to: PlaceFacts,
	fromAmount: string,
	toAmount: string,
): TransferPlanInput => ({
	from,
	to,
	fromCurrency: from.currency,
	toCurrency: to.currency,
	fromAmount: dec(fromAmount),
	toAmount: dec(toAmount),
	homeCurrency: "ARS",
});

describe("counted units are kept at 8 decimals, half to even", () => {
	// USD 20,000 from Wise (out of the budget) to EUR 0.01 (out too): the
	// counted units follow the money as toAmount x counted / fromAmount.
	it.each([
		// 0.01 x 0.01 / 20000 = 5e-9: a tie at 8 dp, 0 is even, so 0.
		["0.01", "0.00000000"],
		// 0.03 x 0.01 / 20000 = 1.5e-8: a tie, 1e-8 is odd, so 2e-8.
		["0.03", "0.00000002"],
		// 0.05 x 0.01 / 20000 = 2.5e-8: a tie, 2e-8 is even, so 2e-8 (half up gives 3e-8).
		["0.05", "0.00000002"],
	])("counted %s follows as %s", (counted, follows) => {
		const plan = planTransfer(move(wise(counted), eurCash, "20000", "0.01"));
		expect(plan.countedFromUnits.toFixed()).toBe(counted);
		expect(plan.countedToUnits.toFixed(8)).toBe(follows);
	});

	it("the units the source gives up round the same way (9 dp input)", () => {
		// min(0.000000005, 20000) is a tie at 8 dp: 0.
		const tie = planTransfer(
			move(wise("0.000000005"), eurCash, "20000", "0.01"),
		);
		expect(tie.countedFromUnits.toFixed(8)).toBe("0.00000000");
		// 0.000000015 is a tie whose lower neighbor is odd: 2e-8.
		const up = planTransfer(
			move(wise("0.000000015"), eurCash, "20000", "0.01"),
		);
		expect(up.countedFromUnits.toFixed(8)).toBe("0.00000002");
	});
});

describe("the rate the typed amounts imply has six decimals, half to even", () => {
	it("ARS 1 for USD 128 is 1 / 128 = 0.0078125, a tie: 0.007812", () => {
		expect(derivedRate(move(wallet, usdCash, "1", "128"))?.value).toBe(
			"0.007812",
		);
	});

	it("USD 128 for ARS 3 is 3 / 128 = 0.0234375, a tie whose lower neighbor is odd: 0.023438", () => {
		expect(derivedRate(move(usdCash, wallet, "128", "3"))?.value).toBe(
			"0.023438",
		);
	});
});

describe("the fresh part entering the budget rounds to minor units half to even", () => {
	// Wise holds 1 counted USD of the 2 sent, so half of the pesos are fresh.
	const enters = (toHome: string) => {
		const input = move(wise("1"), wallet, "2", "0.05");
		return budgetEffect(input, planTransfer(input), {
			fromHome: dec("-0.04"),
			toHome: dec(toHome),
		});
	};

	it("ARS 0.05 x 1 / 2 = 0.025 is 2.5 centavos: 2", () => {
		expect(enters("0.05")).toEqual({
			effect: "enters",
			minor: 2,
			currency: "ARS",
		});
	});

	it("ARS 0.07 x 1 / 2 = 0.035 is 3.5 centavos: 4", () => {
		expect(enters("0.07")).toEqual({
			effect: "enters",
			minor: 4,
			currency: "ARS",
		});
	});
});
