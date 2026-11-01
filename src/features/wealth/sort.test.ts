import { describe, expect, it } from "vitest";
import { moveInOrder, sortAccounts } from "./sort";
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
	it("value: largest home value first, a foreign account by its home value", () => {
		const list = [
			account("Small", { amount: money(1_000) }),
			account("Foreign", {
				amount: money(900_000, "ARS"),
				home: money(5_000),
			}),
			account("Big", { amount: money(20_000) }),
		];
		expect(names(sortAccounts(list, "value", "en"))).toEqual([
			"Big",
			"Foreign",
			"Small",
		]);
	});

	it("value: no rate sorts last, never as zero; a debt sorts by what is owed", () => {
		const list = [
			account("No rate", { amount: money(999_999, "ARS"), home: null }),
			account("Zero", { amount: money(0) }),
			account("Debt", { amount: money(-50_000) }),
		];
		expect(names(sortAccounts(list, "value", "en"))).toEqual([
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

describe("custom order", () => {
	const a = account("A", { amount: money(100) });
	const b = account("B", { amount: money(300) });
	const c = account("C", { amount: money(200) });
	const d = account("D", { amount: money(900) });

	it("follows the saved order exactly", () => {
		expect(
			names(sortAccounts([a, b, c], "custom", "en", ["C", "A", "B"])),
		).toEqual(["C", "A", "B"]);
	});

	it("puts accounts not placed yet after the placed ones, largest first", () => {
		const list = sortAccounts([a, b, c, d], "custom", "en", ["C"]);
		expect(names(list)).toEqual(["C", "D", "B", "A"]);
	});

	it("ignores ids that are no longer accounts", () => {
		expect(
			names(sortAccounts([a, b], "custom", "en", ["gone", "B", "A"])),
		).toEqual(["B", "A"]);
	});

	it("restores the custom order after another sort and back", () => {
		const order = ["B", "C", "A"];
		const list = [a, b, c];
		expect(names(sortAccounts(list, "name", "en", order))).toEqual([
			"A",
			"B",
			"C",
		]);
		expect(names(sortAccounts(list, "value", "en", order))).toEqual([
			"B",
			"C",
			"A",
		]);
		expect(names(sortAccounts(list, "custom", "en", order))).toEqual(order);
	});
});

describe("moveInOrder", () => {
	const x = account("X");
	const y = account("Y");
	const z = account("Z");
	const q = account("Q");
	const all = [x, y, z, q];
	const order = ["X", "Q", "Y", "Z"];

	it("moves inside a group and leaves other accounts in their slots", () => {
		// The group is X, Y, Z (Q belongs to another group): move Z to the front.
		expect(moveInOrder(all, order, "en", ["X", "Y", "Z"], 2, 0)).toEqual([
			"Z",
			"Q",
			"X",
			"Y",
		]);
	});

	it("starts from the fallback order when nothing is saved", () => {
		const big = account("Big", { amount: money(500) });
		const small = account("Small", { amount: money(5) });
		expect(moveInOrder([small, big], [], "en", ["Big", "Small"], 0, 1)).toEqual(
			["Small", "Big"],
		);
	});

	it("is a no-op when the item stays", () => {
		expect(moveInOrder(all, order, "en", ["X", "Y", "Z"], 1, 1)).toEqual(order);
	});
});
