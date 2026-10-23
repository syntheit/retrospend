import { describe, expect, it } from "vitest";
import { dec } from "~/server/services/envelope/units";
import {
	balanceEffect,
	defaultInBudget,
	inBudget,
	placeInBudget,
	worthOf,
} from "./places";

describe("places", () => {
	it("a leg into a card lowers what you owe on it", () => {
		expect(
			balanceEffect("LIABILITY_CREDIT_CARD", dec("842600")).toString(),
		).toBe("-842600");
		expect(balanceEffect("CASH", dec("-842600")).toString()).toBe("-842600");
	});

	it("a liability's balance counts against you", () => {
		expect(worthOf("LIABILITY_LOAN", dec("1000")).toString()).toBe("-1000");
		expect(worthOf("INVESTMENT", dec("1000")).toString()).toBe("1000");
	});

	it("defaults home cash and cards into the budget, everything else out (§2.1)", () => {
		expect(defaultInBudget({ type: "CASH", currency: "ARS" }, "ARS")).toBe(
			true,
		);
		expect(
			defaultInBudget(
				{ type: "LIABILITY_CREDIT_CARD", currency: "ARS" },
				"ARS",
			),
		).toBe(true);
		expect(defaultInBudget({ type: "CASH", currency: "USD" }, "ARS")).toBe(
			false,
		);
		expect(
			defaultInBudget({ type: "INVESTMENT", currency: "ARS" }, "ARS"),
		).toBe(false);
		expect(
			defaultInBudget({ type: "LIABILITY_LOAN", currency: "ARS" }, "ARS"),
		).toBe(false);
	});

	it("an explicit flag wins over the default", () => {
		expect(
			inBudget({ type: "CASH", currency: "USD", inBudget: true }, "ARS"),
		).toBe(true);
		expect(
			inBudget({ type: "CASH", currency: "ARS", inBudget: false }, "ARS"),
		).toBe(false);
	});

	it("Not tracked is in the budget only in the home currency", () => {
		expect(placeInBudget(null, "ARS", "ARS")).toBe(true);
		expect(placeInBudget(null, "USD", "ARS")).toBe(false);
	});
});
