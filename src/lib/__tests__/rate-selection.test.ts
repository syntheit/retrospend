import { describe, expect, it } from "vitest";
import {
	autoRateSelection,
	pairRateTypes,
	pickDefaultRateType,
	preferredRateType,
	rateTypeFromPricingSource,
} from "~/lib/rate-selection";

const rates = {
	official: { type: "official", rate: 1420 },
	blue: { type: "blue", rate: 1480 },
};
const getRateByType = (type: string) =>
	rates[type as keyof typeof rates] ?? null;
const getDefaultRate = () => rates.official;

function pick(args: {
	value?: number;
	activeType?: string;
	isCustomSet?: boolean;
}) {
	return autoRateSelection({
		value: args.value,
		activeType: args.activeType,
		isCustomSet: args.isCustomSet ?? false,
		getRateByType,
		getDefaultRate,
	});
}

describe("autoRateSelection", () => {
	it("opens a saved blue asset on blue and keeps its rate", () => {
		// The bug: the dialog showed (and re-saved) official
		expect(pick({ value: 1480, activeType: "blue" })).toEqual({ type: "blue" });
	});

	it("keeps a saved custom rate custom", () => {
		expect(
			pick({ value: 1500, activeType: "custom", isCustomSet: true }),
		).toEqual({
			type: "custom",
		});
	});

	it("does not touch a saved rate whose type is unknown", () => {
		expect(pick({ value: 1480 })).toBeNull();
	});

	it("picks the default rate once the currency changed and the rate was cleared", () => {
		expect(pick({})).toEqual({ type: "official", rate: 1420 });
	});

	it("prefers the saved type's current rate when the rate is missing", () => {
		expect(pick({ activeType: "blue" })).toEqual({ type: "blue", rate: 1480 });
	});

	it("falls back to the default when the saved type has no rate", () => {
		expect(pick({ activeType: "crypto" })).toEqual({
			type: "official",
			rate: 1420,
		});
	});
});

describe("rate types of a currency pair (N73, ADD-EXPENSE-R2 T7)", () => {
	const ARS = ["official", "blue", "mep", "crypto"];

	it("a USD entry in an ARS home offers the ARS types, Official first", () => {
		// The USD side has no types; the strip comes from the pair, not the
		// entry currency (T7: it used to read USD's, which has none).
		expect(pairRateTypes([], ARS)).toEqual([
			"official",
			"blue",
			"mep",
			"crypto",
		]);
	});

	it("orders Official, Blue, Card, MEP, then the rest A to Z", () => {
		expect(
			pairRateTypes(["tourist", "mep"], ["crypto", "card", "blue", "official"]),
		).toEqual(["official", "blue", "card", "mep", "crypto", "tourist"]);
	});

	it("joins both sides once (an ARS entry in a BOB home)", () => {
		expect(pairRateTypes(ARS, ["official", "blue"])).toEqual(ARS);
	});

	it("a pair with one type each offers that type", () => {
		expect(pairRateTypes(["official"], ["official"])).toEqual(["official"]);
	});
});

describe("default rate type", () => {
	it("is Blue for an ARS home before the user picks one", () => {
		expect(preferredRateType("ARS", {})).toBe("blue");
	});

	it("is the user's pick for their home currency", () => {
		expect(preferredRateType("ARS", { ARS: "mep" })).toBe("mep");
	});

	it("is no preference for other homes (the table order decides)", () => {
		expect(preferredRateType("USD", {})).toBeNull();
		expect(preferredRateType("EUR", { ARS: "mep" })).toBeNull();
	});

	it("picks the preference when the pair offers it", () => {
		expect(pickDefaultRateType(["official", "blue"], "blue")).toBe("blue");
	});

	it("falls back to blue, then official, then crypto, then A to Z", () => {
		expect(pickDefaultRateType(["official", "blue"], "mep")).toBe("blue");
		expect(pickDefaultRateType(["official", "mep"], null)).toBe("official");
		expect(pickDefaultRateType(["tourist", "crypto"], null)).toBe("crypto");
		expect(pickDefaultRateType(["tourist", "card"], null)).toBe("card");
	});

	it("is null when the pair has no rates", () => {
		expect(pickDefaultRateType([], "blue")).toBeNull();
	});
});

describe("rateTypeFromPricingSource (the M2 backfill rule)", () => {
	it.each([
		["blue", "blue"],
		["official", "official"],
		[" MEP ", "mep"],
		["custom", "custom"],
		["Custom", "custom"],
	])("maps %j to %j", (source, type) => {
		expect(rateTypeFromPricingSource(source)).toBe(type);
	});

	it.each([
		"MANUAL",
		"IMPORT",
		"IMPORTED",
		"RECURRING",
		"",
		"Bank statement 2025",
		null,
		undefined,
	])("%j names no rate type", (source) => {
		expect(rateTypeFromPricingSource(source)).toBeNull();
	});
});
