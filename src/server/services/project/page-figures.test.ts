import { describe, expect, it } from "vitest";
import { quote as quoteAt } from "~/server/services/payments/allocate";
import { shareAtHome } from "./page-figures";

const ars = (minor: number) => ({ minor, currency: "ARS" });
const brl = (minor: number) => ({ minor, currency: "BRL" });
const quote = (perUnit: string) => quoteAt(perUnit, "blue");

describe("shareAtHome", () => {
	it("adds shares in other currencies at the reference rates", () => {
		const quotes = new Map([["BRL", quote("250")]]);
		expect(shareAtHome([ars(100000), brl(10000)], "ARS", quotes)).toEqual(
			ars(100000 + 2500000),
		);
	});

	it("is null when every line is home already", () => {
		expect(shareAtHome([ars(5000)], "ARS", new Map())).toBeNull();
	});

	it("is null without a share or a home currency", () => {
		expect(shareAtHome([], "ARS", new Map())).toBeNull();
		expect(shareAtHome([brl(100)], null, new Map())).toBeNull();
	});

	it("is null when a currency has no rate, never 1", () => {
		expect(shareAtHome([ars(100), brl(100)], "ARS", new Map())).toBeNull();
	});
});
