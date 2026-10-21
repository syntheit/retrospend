import { describe, expect, it } from "vitest";
import { evenSharePerPerson } from "./even-split-display";
import { resolveSplits } from "./shared-split-computation";

describe("evenSharePerPerson", () => {
	it("returns the exact share when the total divides evenly", () => {
		expect(evenSharePerPerson(90, 3, "USD")).toBe(30);
		expect(evenSharePerPerson(10.5, 2, "USD")).toBe(5.25);
	});

	it("rounds to the nearest cent instead of flooring", () => {
		// 200 / 3 = 66.666...: two people pay 66.67, one pays 66.66.
		expect(evenSharePerPerson(200, 3, "USD")).toBe(66.67);
		// 100 / 3 = 33.333...: one pays 33.34, two pay 33.33.
		expect(evenSharePerPerson(100, 3, "USD")).toBe(33.33);
	});

	it("matches what most people pay in the saved split", () => {
		for (const [amount, count] of [
			[200, 3],
			[100, 3],
			[10, 6],
			[0.07, 4],
		] as const) {
			const participants = Array.from({ length: count }, (_, i) => ({
				participantType: "user" as const,
				participantId: `p${i}`,
			}));
			const shares = resolveSplits({
				mode: "EQUAL",
				amount,
				currency: "USD",
				participants,
				paidBy: participants[0]!,
			}).map((s) => s.shareAmount);
			const counts = new Map<number, number>();
			for (const s of shares) counts.set(s, (counts.get(s) ?? 0) + 1);
			const most = Math.max(...counts.values());
			expect(counts.get(evenSharePerPerson(amount, count, "USD"))).toBe(most);
		}
	});

	it("returns 0 for no participants", () => {
		expect(evenSharePerPerson(100, 0, "USD")).toBe(0);
	});
});
