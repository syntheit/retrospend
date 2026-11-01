import { describe, expect, it } from "vitest";
import { readSort, sortAccounts } from "./sort";
import type { WealthAccount } from "./types";

const money = (minor: number, currency = "USD") => ({
	minor,
	currency,
});

function account(
	name: string,
	patch: Partial<WealthAccount> = {},
): WealthAccount {
	return {
		id: name,
		name,
		type: "CASH",
		kind: "bank",
		group: "cash",
		amount: money(0),
		storedSign: 1,
		liquid: true,
		rateType: null,
		rateTypes: [],
		valuation: { type: null, customRate: null },
		apr: null,
		updated: "2026-10-01",
		closedOn: null,
		...patch,
	} as WealthAccount;
}

const names = (list: WealthAccount[]) => list.map((a) => a.name);

describe("sortAccounts", () => {
	it("balance: largest home value first, a foreign account by its home value", () => {
		const list = [
			account("Small", { amount: money(1_000) }),
			account("Foreign", {
				amount: money(900_000, "ARS"),
				home: money(5_000),
			}),
			account("Big", { amount: money(20_000) }),
		];
		expect(names(sortAccounts(list, "balance", "en"))).toEqual([
			"Big",
			"Foreign",
			"Small",
		]);
	});

	it("balance: no rate sorts last, never as zero; a debt sorts by what is owed", () => {
		const list = [
			account("No rate", { amount: money(999_999, "ARS"), home: null }),
			account("Zero", { amount: money(0) }),
			account("Debt", { amount: money(-50_000) }),
		];
		expect(names(sortAccounts(list, "balance", "en"))).toEqual([
			"Debt",
			"Zero",
			"No rate",
		]);
	});

	it("name: A to Z ignoring case and accents", () => {
		const list = [account("beta"), account("Ángel"), account("Alpha")];
		expect(names(sortAccounts(list, "name", "es"))).toEqual([
			"Alpha",
			"Ángel",
			"beta",
		]);
	});

	it("type: kinds in the order of the groups, then by name", () => {
		const list = [
			account("Loan", { type: "LIABILITY_LOAN" }),
			account("Coins", { type: "CRYPTO" }),
			account("Wallet", { type: "CASH" }),
			account("Bank", { type: "CASH" }),
		];
		expect(names(sortAccounts(list, "type", "en"))).toEqual([
			"Bank",
			"Wallet",
			"Coins",
			"Loan",
		]);
	});

	it("updated: newest first", () => {
		const list = [
			account("Old", { updated: "2026-01-02" }),
			account("New", { updated: "2026-10-30" }),
			account("Mid", { updated: "2026-05-01" }),
		];
		expect(names(sortAccounts(list, "updated", "en"))).toEqual([
			"New",
			"Mid",
			"Old",
		]);
	});

	it("does not change the list it was given", () => {
		const list = [account("b"), account("a")];
		sortAccounts(list, "name", "en");
		expect(names(list)).toEqual(["b", "a"]);
	});
});

describe("readSort", () => {
	it("keeps a known sort and falls back to balance", () => {
		expect(readSort("updated")).toBe("updated");
		expect(readSort("bogus")).toBe("balance");
		expect(readSort(undefined)).toBe("balance");
	});
});
