import { describe, expect, it } from "vitest";
import { dec } from "../precise-decimal";
import { bookHome } from "./book-home";
import type { RatePick } from "./valuation";

const day = new Date("2026-11-26T00:00:00.000Z");
const none: RatePick = () => null;

describe("bookHome", () => {
	it("books an exact tie at 8 places to the even digit (0.00000005 at 2 per USD is 0.000000025)", () => {
		const home = bookHome(
			none,
			{
				currency: "ARS",
				account: {
					currency: "ARS",
					exchangeRateType: "custom",
					exchangeRate: "2",
				},
			},
			dec("0.00000005"),
			"USD",
			day,
		);
		// Half-up would give 0.00000003.
		expect(home?.amount.toFixed(8)).toBe("0.00000002");
		expect(home?.currency).toBe("USD");
	});

	it("home money books itself", () => {
		const home = bookHome(
			none,
			{ currency: "ARS", account: null },
			dec("-250.5"),
			"ARS",
			day,
		);
		expect(home?.amount.toString()).toBe("-250.5");
	});

	it("no rate books nothing, never 1", () => {
		expect(
			bookHome(
				none,
				{ currency: "ARS", account: null },
				dec("100"),
				"USD",
				day,
			),
		).toBeNull();
	});
});
