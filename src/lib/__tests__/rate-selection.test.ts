import { describe, expect, it } from "vitest";
import { autoRateSelection } from "~/lib/rate-selection";

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
		expect(pick({ value: 1500, activeType: "custom", isCustomSet: true })).toEqual({
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
		expect(pick({ activeType: "crypto" })).toEqual({ type: "official", rate: 1420 });
	});
});
