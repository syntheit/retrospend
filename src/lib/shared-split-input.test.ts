import { describe, expect, it } from "vitest";
import { buildSplitInput, type SplitState } from "./shared-split-input";

const you = { participantType: "user" as const, participantId: "me" };
const lucia = { participantType: "user" as const, participantId: "lucia" };
const paz = { participantType: "shadow" as const, participantId: "paz" };

const base: SplitState = {
	mode: "EQUAL",
	you,
	youIncluded: true,
	others: [lucia],
	paidBy: you,
	fullAmount: false,
	amount: 6000,
	exact: {},
	percentages: {},
	shares: {},
};

describe("buildSplitInput", () => {
	it("evenly: the members only, the server divides", () => {
		expect(buildSplitInput(base)).toEqual({
			splitMode: "EQUAL",
			splitWith: [you, lucia],
		});
	});

	it("Lucía owes all when you paid: one row for her with the whole amount", () => {
		expect(buildSplitInput({ ...base, fullAmount: true })).toEqual({
			splitMode: "EXACT",
			splitWith: [{ ...lucia, shareAmount: 6000 }],
		});
	});

	it("You owe all when she paid: one row for you", () => {
		expect(
			buildSplitInput({ ...base, fullAmount: true, paidBy: lucia }),
		).toEqual({ splitMode: "EXACT", splitWith: [{ ...you, shareAmount: 6000 }] });
	});

	it("owes all is ignored for more than one other person and in custom modes", () => {
		const three = { ...base, others: [lucia, paz], fullAmount: true };
		expect(buildSplitInput(three).splitMode).toBe("EQUAL");
		const shares = { ...base, mode: "SHARES" as const, fullAmount: true };
		expect(buildSplitInput(shares)).toEqual({
			splitMode: "SHARES",
			splitWith: [
				{ ...you, shareUnits: 1 },
				{ ...lucia, shareUnits: 1 },
			],
		});
	});

	it("custom amounts and percentages per person; you can leave the split", () => {
		expect(
			buildSplitInput({
				...base,
				mode: "EXACT",
				youIncluded: false,
				others: [lucia, paz],
				exact: { "user:lucia": 4000, "shadow:paz": 2000 },
			}).splitWith,
		).toEqual([
			{ ...lucia, shareAmount: 4000 },
			{ ...paz, shareAmount: 2000 },
		]);
		expect(
			buildSplitInput({
				...base,
				mode: "PERCENTAGE",
				percentages: { "user:me": 70 },
			}).splitWith,
		).toEqual([
			{ ...you, sharePercentage: 70 },
			{ ...lucia, sharePercentage: 50 },
		]);
	});

	it("Percentage tab left at its starting values is the even split: sent as EQUAL", () => {
		const three = { ...base, mode: "PERCENTAGE" as const, others: [lucia, paz] };
		// Nothing set, or the tab's 33.33 / 33.33 / 33.34: untouched.
		for (const percentages of [
			{} as Record<string, number>,
			{ "user:me": 33.33, "user:lucia": 33.33, "shadow:paz": 33.34 },
		]) {
			expect(buildSplitInput({ ...three, percentages })).toEqual({
				splitMode: "EQUAL",
				splitWith: [you, lucia, paz],
			});
		}
		// 50 / 50 for two people is the starting value too.
		expect(
			buildSplitInput({
				...base,
				mode: "PERCENTAGE",
				percentages: { "user:me": 50, "user:lucia": 50 },
			}).splitMode,
		).toBe("EQUAL");
	});

	it("one percentage changed keeps every row as typed", () => {
		const three = {
			...base,
			mode: "PERCENTAGE" as const,
			others: [lucia, paz],
			percentages: { "user:me": 33.33, "user:lucia": 33.34, "shadow:paz": 33.33 },
		};
		expect(buildSplitInput(three)).toEqual({
			splitMode: "PERCENTAGE",
			splitWith: [
				{ ...you, sharePercentage: 33.33 },
				{ ...lucia, sharePercentage: 33.34 },
				{ ...paz, sharePercentage: 33.33 },
			],
		});
	});

	it("a person listed twice is sent once", () => {
		expect(
			buildSplitInput({ ...base, others: [lucia, lucia] }).splitWith,
		).toEqual([you, lucia]);
	});
});
