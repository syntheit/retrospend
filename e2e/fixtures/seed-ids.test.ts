import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ACCOUNTS } from "./ledger";
import { PROJECT_IDS, seedId } from "./personas";

describe("seed ids", () => {
	it("pass the routers' cuid check", () => {
		const ids = [
			...Object.values(PROJECT_IDS),
			seedId("cat", "sofia", "Food Delivery"),
			seedId("rate", "ARS", "official"),
			seedId("asset", "cash_usd"),
			seedId("budget", "total", "0"),
			seedId("rec", "alquiler"),
		];
		for (const id of ids) expect(z.cuid().safeParse(id).success, id).toBe(true);
	});

	it("keep parts apart", () => {
		expect(seedId("asset", "visa")).toBe("ce2easset0visa");
	});
});

describe("seed accounts", () => {
	// WealthService subtracts liabilities, so a negative one would add twice.
	it("hold liabilities as positive balances", () => {
		const liabilities = ACCOUNTS.filter((a) => a.type.startsWith("LIABILITY_"));
		expect(liabilities.length).toBeGreaterThan(0);
		for (const a of liabilities) expect(a.balance).toBeGreaterThan(0);
	});
});
