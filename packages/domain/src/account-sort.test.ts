import { describe, expect, it } from "vitest";
import { moveInOrder, type SortFacts, sortAccounts } from "./account-sort";

const acct = (
	name: string,
	size: number | null = 0,
	over: Partial<SortFacts> = {},
): SortFacts => ({
	id: name,
	name,
	type: "CASH",
	size,
	updated: "2026-10-01",
	...over,
});
const same = (a: SortFacts) => a;
const names = (list: SortFacts[]) => list.map((a) => a.name);
const order = (
	list: SortFacts[],
	mode: Parameters<typeof sortAccounts>[1],
	custom: string[] = [],
) => names(sortAccounts(list, mode, "en", custom, same));

describe("sortAccounts", () => {
	it("value: largest first, no rate last and never as zero", () => {
		const list = [
			acct("Small", 10),
			acct("None", null),
			acct("Zero", 0),
			acct("Big", 99),
		];
		expect(order(list, "value")).toEqual(["Big", "Small", "Zero", "None"]);
	});

	it("name: A to Z ignoring case and accents", () => {
		const list = [acct("beta"), acct("Ángel"), acct("Alpha")];
		expect(names(sortAccounts(list, "name", "es", [], same))).toEqual([
			"Alpha",
			"Ángel",
			"beta",
		]);
	});

	it("type: the kinds in the order of the groups, then by name", () => {
		const list = [
			acct("Loan", 1, { type: "LIABILITY_LOAN" }),
			acct("Coins", 1, { type: "CRYPTO" }),
			acct("Wallet"),
			acct("Bank"),
		];
		expect(order(list, "type")).toEqual(["Bank", "Wallet", "Coins", "Loan"]);
	});

	it("updated: newest first", () => {
		const list = [
			acct("Old", 1, { updated: "2026-01-02" }),
			acct("New", 1, { updated: "2026-10-30" }),
		];
		expect(order(list, "updated")).toEqual(["New", "Old"]);
	});

	it("custom follows the saved order, then the unplaced by size, ignoring gone ids", () => {
		const list = [acct("A", 1), acct("B", 3), acct("C", 2), acct("D", 9)];
		expect(order(list, "custom", ["gone", "C"])).toEqual(["C", "D", "B", "A"]);
		expect(order(list, "custom", ["B", "A", "D", "C"])).toEqual([
			"B",
			"A",
			"D",
			"C",
		]);
	});

	it("restores the custom order after another sort and back", () => {
		const list = [acct("A", 1), acct("B", 3), acct("C", 2)];
		const saved = ["C", "A", "B"];
		expect(order(list, "name", saved)).toEqual(["A", "B", "C"]);
		expect(order(list, "custom", saved)).toEqual(saved);
	});

	it("does not change the list it was given", () => {
		const list = [acct("b"), acct("a")];
		sortAccounts(list, "name", "en", [], same);
		expect(names(list)).toEqual(["b", "a"]);
	});
});

describe("moveInOrder", () => {
	const all = [acct("X"), acct("Y"), acct("Z"), acct("Q")];
	const saved = ["X", "Q", "Y", "Z"];

	it("moves inside a group and leaves the other accounts in their slots", () => {
		expect(moveInOrder(all, saved, "en", ["X", "Y", "Z"], 2, 0, same)).toEqual([
			"Z",
			"Q",
			"X",
			"Y",
		]);
	});

	it("starts from the fallback order when nothing is saved", () => {
		const two = [acct("Small", 5), acct("Big", 500)];
		expect(moveInOrder(two, [], "en", ["Big", "Small"], 0, 1, same)).toEqual([
			"Small",
			"Big",
		]);
	});

	it("is a no-op when the account stays", () => {
		expect(moveInOrder(all, saved, "en", ["X", "Y", "Z"], 1, 1, same)).toEqual(
			saved,
		);
	});
});
