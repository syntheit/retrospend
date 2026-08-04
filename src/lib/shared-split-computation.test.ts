import { describe, expect, it } from "vitest";
import {
	resolveSplits,
	SplitComputationError,
	type SplitParticipantInput,
} from "./shared-split-computation";

const payer = { participantType: "user" as const, participantId: "alice" };

function user(id: string): SplitParticipantInput {
	return { participantType: "user", participantId: id };
}

function sumCents(splits: Array<{ shareAmount: number }>): number {
	return Math.round(splits.reduce((a, s) => a + s.shareAmount, 0) * 100);
}

describe("resolveSplits", () => {
	describe("EQUAL", () => {
		it("divides evenly when the amount is divisible", () => {
			const splits = resolveSplits({
				mode: "EQUAL",
				amount: 100,
				participants: [user("alice"), user("bob")],
				paidBy: payer,
			});
			expect(splits.map((s) => s.shareAmount)).toEqual([50, 50]);
		});

		it("gives the leftover cent to the payer first", () => {
			const splits = resolveSplits({
				mode: "EQUAL",
				amount: 100,
				participants: [user("alice"), user("bob"), user("carol")],
				paidBy: payer,
			});
			// alice (payer) gets the extra cent
			expect(splits.map((s) => s.shareAmount)).toEqual([33.34, 33.33, 33.33]);
			expect(sumCents(splits)).toBe(10000);
		});

		it("payer outside the split: fills remaining rows from index 0", () => {
			const splits = resolveSplits({
				mode: "EQUAL",
				amount: 100,
				participants: [user("bob"), user("carol"), user("dave")],
				paidBy: payer, // alice, not in the split
			});
			expect(splits.map((s) => s.shareAmount)).toEqual([33.34, 33.33, 33.33]);
			expect(sumCents(splits)).toBe(10000);
		});

		it("single participant owes the whole amount", () => {
			const splits = resolveSplits({
				mode: "EQUAL",
				amount: 42.5,
				participants: [user("bob")],
				paidBy: payer,
			});
			expect(splits).toHaveLength(1);
			expect(splits[0]!.shareAmount).toBe(42.5);
		});

		it("$0.01 across 2, payer gets the only cent", () => {
			const splits = resolveSplits({
				mode: "EQUAL",
				amount: 0.01,
				participants: [user("alice"), user("bob")],
				paidBy: payer,
			});
			expect(splits.map((s) => s.shareAmount)).toEqual([0.01, 0]);
		});

		it("preserves guest and shadow participant types", () => {
			const splits = resolveSplits({
				mode: "EQUAL",
				amount: 10,
				participants: [
					user("alice"),
					{ participantType: "guest", participantId: "g1" },
					{ participantType: "shadow", participantId: "s1" },
				],
				paidBy: payer,
			});
			expect(splits.find((s) => s.participantId === "g1")!.participantType).toBe(
				"guest",
			);
			expect(splits.find((s) => s.participantId === "s1")!.participantType).toBe(
				"shadow",
			);
			expect(splits.find((s) => s.participantId === "alice")!.shareAmount).toBe(
				3.34,
			);
		});
	});

	describe("EXACT", () => {
		it("passes through exact amounts that sum to the total", () => {
			const splits = resolveSplits({
				mode: "EXACT",
				amount: 100,
				participants: [
					{ ...user("alice"), shareAmount: 70 },
					{ ...user("bob"), shareAmount: 30 },
				],
				paidBy: payer,
			});
			expect(splits.map((s) => s.shareAmount)).toEqual([70, 30]);
		});

		it("throws when the amounts do not sum to the total", () => {
			expect(() =>
				resolveSplits({
					mode: "EXACT",
					amount: 100,
					participants: [
						{ ...user("alice"), shareAmount: 60 },
						{ ...user("bob"), shareAmount: 50 },
					],
					paidBy: payer,
				}),
			).toThrow(SplitComputationError);
		});

		it("throws with the transaction-amount message", () => {
			expect(() =>
				resolveSplits({
					mode: "EXACT",
					amount: 100,
					participants: [{ ...user("alice"), shareAmount: 90 }],
					paidBy: payer,
				}),
			).toThrow("Split amounts must sum to the transaction amount");
		});
	});

	describe("PERCENTAGE", () => {
		it("computes amounts from percentages and keeps sharePercentage", () => {
			const splits = resolveSplits({
				mode: "PERCENTAGE",
				amount: 100,
				participants: [
					{ ...user("alice"), sharePercentage: 60 },
					{ ...user("bob"), sharePercentage: 40 },
				],
				paidBy: payer,
			});
			expect(splits[0]!.shareAmount).toBe(60);
			expect(splits[1]!.shareAmount).toBe(40);
			expect(splits[0]!.sharePercentage).toBe(60);
		});

		it("routes the rounding remainder to the payer", () => {
			const splits = resolveSplits({
				mode: "PERCENTAGE",
				amount: 33.33,
				participants: [
					{ ...user("alice"), sharePercentage: 50 },
					{ ...user("bob"), sharePercentage: 50 },
				],
				paidBy: payer,
			});
			expect(splits[0]!.shareAmount).toBe(16.67); // payer
			expect(splits[1]!.shareAmount).toBe(16.66);
			expect(sumCents(splits)).toBe(3333);
		});

		it("payer outside the split: remainder goes to the last row", () => {
			const splits = resolveSplits({
				mode: "PERCENTAGE",
				amount: 33.33,
				participants: [
					{ ...user("bob"), sharePercentage: 50 },
					{ ...user("carol"), sharePercentage: 50 },
				],
				paidBy: payer, // alice, outside
			});
			expect(splits[0]!.shareAmount).toBe(16.66);
			expect(splits[1]!.shareAmount).toBe(16.67); // last row absorbs remainder
			expect(sumCents(splits)).toBe(3333);
		});

		it("throws when percentages do not sum to 100", () => {
			expect(() =>
				resolveSplits({
					mode: "PERCENTAGE",
					amount: 100,
					participants: [
						{ ...user("alice"), sharePercentage: 50 },
						{ ...user("bob"), sharePercentage: 40 },
					],
					paidBy: payer,
				}),
			).toThrow("Percentages must sum to 100");
		});

		it("throws when sharePercentage is missing", () => {
			expect(() =>
				resolveSplits({
					mode: "PERCENTAGE",
					amount: 100,
					participants: [user("alice"), { ...user("bob"), sharePercentage: 50 }],
					paidBy: payer,
				}),
			).toThrow("missing sharePercentage");
		});
	});

	describe("SHARES", () => {
		it("splits by weight and keeps shareUnits", () => {
			const splits = resolveSplits({
				mode: "SHARES",
				amount: 90,
				participants: [
					{ ...user("alice"), shareUnits: 2 },
					{ ...user("bob"), shareUnits: 1 },
				],
				paidBy: payer,
			});
			expect(splits[0]!.shareAmount).toBe(60);
			expect(splits[1]!.shareAmount).toBe(30);
			expect(splits[0]!.shareUnits).toBe(2);
		});

		it("routes the remainder to the payer when in the split", () => {
			const splits = resolveSplits({
				mode: "SHARES",
				amount: 100,
				participants: [
					{ ...user("alice"), shareUnits: 10 },
					{ ...user("bob"), shareUnits: 1 },
				],
				paidBy: payer,
			});
			// alice floor 9090 + remainder cent = 9091
			expect(splits[0]!.shareAmount).toBe(90.91);
			expect(splits[1]!.shareAmount).toBe(9.09);
			expect(sumCents(splits)).toBe(10000);
		});

		it("payer outside the split: remainder goes to the last row", () => {
			const splits = resolveSplits({
				mode: "SHARES",
				amount: 100,
				participants: [
					{ ...user("bob"), shareUnits: 10 },
					{ ...user("carol"), shareUnits: 1 },
				],
				paidBy: payer, // alice, outside
			});
			expect(splits[0]!.shareAmount).toBe(90.9);
			expect(splits[1]!.shareAmount).toBe(9.1); // last row absorbs remainder
			expect(sumCents(splits)).toBe(10000);
		});

		it("throws when shareUnits is missing or < 1", () => {
			expect(() =>
				resolveSplits({
					mode: "SHARES",
					amount: 100,
					participants: [user("alice"), { ...user("bob"), shareUnits: 1 }],
					paidBy: payer,
				}),
			).toThrow("shareUnits >= 1");
		});
	});
});
