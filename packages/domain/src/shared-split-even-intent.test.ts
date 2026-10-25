import { describe, expect, it } from "vitest";
import {
	resolveSplits,
	type SplitParticipantInput,
} from "./shared-split-computation";

/**
 * An even split sent as percentages (100 / n) is stored by the database at 4
 * decimals (older rows at 2). A later amount edit re-splits from those stored
 * values and has to land on the exact n-way even split again, not on the
 * rounded percentages. All expected values below are worked out by hand in
 * minor units.
 */

const ids = ["alice", "bob", "carol", "dan", "erin", "fay", "gus", "hal", "ivy"];
const people = (n: number): SplitParticipantInput[] =>
	ids.slice(0, n).map((participantId) => ({
		participantType: "user" as const,
		participantId,
	}));
const ref = (participantId: string) => ({
	participantType: "user" as const,
	participantId,
});

function percentSplit(
	pcts: number[],
	amount: number,
	currency: string,
	paidBy: string,
) {
	return resolveSplits({
		mode: "PERCENTAGE",
		amount,
		currency,
		participants: people(pcts.length).map((p, i) => ({
			...p,
			sharePercentage: pcts[i],
		})),
		paidBy: ref(paidBy),
	});
}

const amounts = (rows: Array<{ shareAmount: number }>) =>
	rows.map((r) => r.shareAmount);
const percents = (rows: Array<{ sharePercentage?: number }>) =>
	rows.map((r) => r.sharePercentage);

describe("an even split sent as percentages stays the exact even split", () => {
	it("100.00 over 3 gives the odd cent to the payer, then 100.01 and 200.00 re-split exactly", () => {
		// 10000 = 3 * 3333 + 1: alice (payer) takes the extra cent.
		const created = percentSplit(
			[100 / 3, 100 / 3, 100 / 3],
			100,
			"USD",
			"alice",
		);
		expect(amounts(created)).toEqual([33.34, 33.33, 33.33]);
		// 100 / 3 to the 4 decimals the database keeps.
		expect(percents(created)).toEqual([33.3333, 33.3333, 33.3333]);

		const stored = percents(created) as number[];
		// 10001 = 3 * 3333 + 2: alice, then bob.
		expect(amounts(percentSplit(stored, 100.01, "USD", "alice"))).toEqual([
			33.34, 33.34, 33.33,
		]);
		// 20000 = 3 * 6666 + 2.
		expect(amounts(percentSplit(stored, 200, "USD", "alice"))).toEqual([
			66.67, 66.67, 66.66,
		]);
	});

	it("rows stored at 2 decimals (33.33 each, or 33.33 / 33.33 / 33.34) re-split the same way", () => {
		for (const stored of [
			[33.33, 33.33, 33.33],
			[33.33, 33.33, 33.34],
		]) {
			expect(amounts(percentSplit(stored, 100.01, "USD", "alice"))).toEqual([
				33.34, 33.34, 33.33,
			]);
		}
	});

	it("7 ways: 14.29 each (sum 100.03) is accepted and splits 100.00 as 4 x 14.29 and 3 x 14.28", () => {
		// 10000 = 7 * 1428 + 4: the payer (dan, row 3) first, then rows 0, 1, 2.
		const rows = percentSplit(
			[14.29, 14.29, 14.29, 14.29, 14.29, 14.29, 14.29],
			100,
			"USD",
			"dan",
		);
		expect(amounts(rows)).toEqual([
			14.29, 14.29, 14.29, 14.29, 14.28, 14.28, 14.28,
		]);
		expect(percents(rows)).toEqual(Array(7).fill(14.2857));
	});

	it("ARS 1,234,567.91 over 3: 123456791 = 3 * 41152263 + 2", () => {
		expect(
			amounts(
				percentSplit([100 / 3, 100 / 3, 100 / 3], 1234567.91, "ARS", "alice"),
			),
		).toEqual([411522.64, 411522.64, 411522.63]);
	});

	it("0.004 ETH over 3 in 8-decimal units, then 0.00400001", () => {
		// 400000 = 3 * 133333 + 1: carol is the payer.
		const created = percentSplit(
			[100 / 3, 100 / 3, 100 / 3],
			0.004,
			"ETH",
			"carol",
		);
		expect(amounts(created)).toEqual([0.00133333, 0.00133333, 0.00133334]);
		// 400001 = 3 * 133333 + 2: carol, then alice.
		expect(
			amounts(
				percentSplit(percents(created) as number[], 0.00400001, "ETH", "carol"),
			),
		).toEqual([0.00133334, 0.00133333, 0.00133334]);
	});

	it("matches EQUAL for every n whose 100 / n has no short decimal, from the stored values", () => {
		for (const n of [3, 6, 7, 9]) {
			const created = percentSplit(
				Array(n).fill(100 / n),
				1000.01,
				"USD",
				"bob",
			);
			const stored = percents(created) as number[];
			const equal = resolveSplits({
				mode: "EQUAL",
				amount: 77.77,
				currency: "USD",
				participants: people(n),
				paidBy: ref("bob"),
			});
			expect(amounts(percentSplit(stored, 77.77, "USD", "bob"))).toEqual(
				amounts(equal),
			);
		}
	});

	it("a payer outside the even split: extra cents go in row order, like EQUAL", () => {
		// 10001 = 3 * 3333 + 2, dan is not in the split: alice, bob.
		expect(
			amounts(percentSplit([33.33, 33.33, 33.33], 100.01, "USD", "dan")),
		).toEqual([33.34, 33.34, 33.33]);
	});
});

describe("typed percentages keep their rule", () => {
	it("4 x 25 is typed exactly: the leftover goes to the last row when the payer is outside", () => {
		// 10001: floor(10001 * 25 / 100) = 2500 each, 1 left over for the last row.
		expect(
			amounts(percentSplit([25, 25, 25, 25], 100.01, "USD", "zed")),
		).toEqual([25, 25, 25, 25.01]);
	});

	it("12.3456 / 87.6544 of 100.00: 1234 and 8765 cents, the leftover cent to the payer", () => {
		// floor(10000 * 123456 / 1e6) = 1234, floor(10000 * 876544 / 1e6) = 8765.
		const rows = percentSplit([12.3456, 87.6544], 100, "USD", "alice");
		expect(amounts(rows)).toEqual([12.35, 87.65]);
		expect(percents(rows)).toEqual([12.3456, 87.6544]);
	});

	it("a split that is near even but not within a hundredth of a percent is typed", () => {
		// 33.4 is 0.0667 above 100 / 3, so these are the percentages as typed.
		expect(
			amounts(percentSplit([33.4, 33.3, 33.3], 100, "USD", "zed")),
		).toEqual([33.4, 33.3, 33.3]);
	});
});
