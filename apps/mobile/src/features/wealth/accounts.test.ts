import {
	closedAccounts,
	groupOf,
	isLiability,
	sectionsOf,
	unvalued,
} from "./accounts";
import type { Account } from "./source";

function account(
	id: string,
	type: Account["type"],
	over: Partial<Account> = {},
): Account {
	return {
		id,
		name: id,
		type,
		currency: "ARS",
		balance: { minor: 100, currency: "ARS" },
		value: { minor: 100, currency: "ARS" },
		closedAt: null,
		...over,
	} as Account;
}

describe("account groups", () => {
	it("puts each type in its group", () => {
		expect(groupOf("CASH")).toBe("cash");
		expect(groupOf("VEHICLE")).toBe("property");
		expect(groupOf("REAL_ESTATE")).toBe("property");
		expect(groupOf("LIABILITY_MORTGAGE")).toBe("liabilities");
		expect(isLiability("LIABILITY_CREDIT_CARD")).toBe(true);
		expect(isLiability("CRYPTO")).toBe(false);
	});

	it("orders sections the same way every time and skips empty ones", () => {
		const sections = sectionsOf([
			account("loan", "LIABILITY_LOAN"),
			account("fci", "INVESTMENT"),
			account("galicia", "CASH"),
			account("wise", "CASH"),
		]);
		expect(sections.map((s) => s.group)).toEqual([
			"cash",
			"investments",
			"liabilities",
		]);
		expect(sections[0]?.accounts.map((a) => a.id)).toEqual(["galicia", "wise"]);
	});

	it("lists closed accounts apart, out of the sections", () => {
		const closed = account("old", "CASH", {
			closedAt: "2026-01-01T00:00:00.000Z",
		});
		expect(sectionsOf([closed])).toEqual([]);
		expect(closedAccounts([closed, account("open", "CASH")])).toEqual([closed]);
	});

	it("finds the accounts with no rate", () => {
		const noRate = account("usd", "CASH", { value: null });
		expect(unvalued([noRate, account("ars", "CASH")])).toEqual([noRate]);
		expect(
			unvalued([
				account("x", "CASH", {
					value: null,
					closedAt: "2026-01-01T00:00:00.000Z",
				}),
			]),
		).toEqual([]);
	});
});
