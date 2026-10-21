import { describe, expect, it } from "vitest";
import {
	allocateAcrossScopes,
	scopeDebtsForCurrency,
} from "./settlement-allocation";

describe("allocateAcrossScopes", () => {
	it("pays the smallest debts first, direct bucket first on ties", () => {
		expect(
			allocateAcrossScopes(
				[
					{ projectId: "B", owed: 10 },
					{ projectId: "A", owed: 10 },
					{ projectId: null, owed: 10 },
					{ projectId: "C", owed: 5 },
				],
				22,
			),
		).toEqual([
			{ projectId: "C", amount: 5 },
			{ projectId: null, amount: 10 },
			{ projectId: "A", amount: 7 },
		]);
	});

	it("never gives a scope more than it owes", () => {
		const result = allocateAcrossScopes(
			[
				{ projectId: "A", owed: 40 },
				{ projectId: "B", owed: 10 },
			],
			50,
		);
		expect(result).toEqual([
			{ projectId: "B", amount: 10 },
			{ projectId: "A", amount: 40 },
		]);
	});

	it("drops a tolerance-level excess instead of over-paying a scope", () => {
		// The caller allows up to 0.01 over the global debt. That excess must not
		// land on a row, or the scope would show a cent of reverse debt.
		expect(
			allocateAcrossScopes(
				[
					{ projectId: "A", owed: 9.995 },
					{ projectId: null, owed: 5 },
				],
				15.005,
			),
		).toEqual([
			{ projectId: null, amount: 5 },
			{ projectId: "A", amount: 9.995 },
		]);
	});

	it("returns nothing when nothing is owed in any scope", () => {
		expect(allocateAcrossScopes([], 0.01)).toEqual([]);
	});

	it("ignores non-positive debts and returns nothing for a zero amount", () => {
		expect(
			allocateAcrossScopes([{ projectId: "A", owed: 0 }], 0),
		).toEqual([]);
	});
});

describe("scopeDebtsForCurrency", () => {
	it("keeps only scopes where the payer owes in that currency", () => {
		const byProject = new Map<string | null, Record<string, number>>([
			["A", { USD: -30, EUR: 5 }],
			["B", { USD: 15 }],
			[null, { USD: -2 }],
		]);
		expect(scopeDebtsForCurrency(byProject, "USD")).toEqual([
			{ projectId: "A", owed: 30 },
			{ projectId: null, owed: 2 },
		]);
		expect(scopeDebtsForCurrency(byProject, "EUR")).toEqual([]);
	});
});
