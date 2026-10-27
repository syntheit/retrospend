import { describe, expect, it } from "vitest";
import { priceCents } from "./price-cents";

describe("priceCents", () => {
	it("whole from 100 units up, the digits below", () => {
		expect(priceCents({ minor: 155500, currency: "ARS", places: 2 })).toBe(
			false,
		);
		expect(priceCents({ minor: 27685, currency: "ARS", places: 2 })).toBe(
			false,
		);
		expect(priceCents({ minor: 9999, currency: "ARS", places: 2 })).toBe(
			"auto",
		);
		expect(priceCents({ minor: 535, currency: "BRL", places: 2 })).toBe("auto");
		// JPY has no minor unit: 100 yen is 100 minor.
		expect(priceCents({ minor: 150, currency: "JPY", places: 0 })).toBe(false);
	});

	it("a rate under one minor unit keeps its digits", () => {
		expect(priceCents({ minor: 64, currency: "USD", places: 5 })).toBe("auto");
		expect(priceCents({ minor: 1493, currency: "BTC", places: 8 })).toBe(
			"auto",
		);
		expect(priceCents({ minor: 307, currency: "KWD", places: 3 })).toBe("auto");
	});
});
