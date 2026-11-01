import {
	storedRateToTyped,
	typedRateToStored,
} from "@retrospend/domain/rate-format";
import { describe, expect, it } from "vitest";
import { customDirection } from "./custom-direction";

// USD home, an ARS expense saved with custom rate 0.000647165416 on a date
// with no ARS table rate: the pair reads "1 USD = 1,545.20 ARS" throughout.
const saved = "0.000647165416";
const pair = { currency: "ARS", home: "USD", table: null, savedRate: saved };

describe("customDirection", () => {
	it("keeps the saved rate's direction from the click through the typing", () => {
		const dir = customDirection(pair);
		expect(dir).toEqual({ base: "USD", quote: "ARS", flipped: true });
		// Enter rate prefills the number the pair reads as.
		expect(storedRateToTyped(saved, dir.flipped, "en-US")).toBe("1545.2");
		// The typed rate is never a reference: the next render has the same direction.
		expect(customDirection({ ...pair })).toEqual(dir);
		// Typing 1545.3 books the inverse, not "1545.3".
		const booked = typedRateToStored("1545.3", dir.flipped, "en-US");
		expect(booked).toBe("0.000647123536");
		expect(booked).not.toBe("1545.3");
	});

	it("lets the table decide where it has a rate", () => {
		expect(customDirection({ ...pair, table: "0.00065" }).flipped).toBe(true);
		expect(customDirection({ ...pair, table: "1545.2" }).flipped).toBe(false);
	});

	it("reads in the stored direction with no rate at all", () => {
		expect(customDirection({ ...pair, savedRate: null })).toEqual({
			base: "ARS",
			quote: "USD",
			flipped: false,
		});
	});
});
