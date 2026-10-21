import { describe, expect, it } from "vitest";
import { evenSharePerPerson } from "./even-split-display";
import {
	resolveSplits,
	SplitComputationError,
	type SplitParticipantInput,
} from "./shared-split-computation";

const payer = { participantType: "user" as const, participantId: "alice" };

function user(id: string): SplitParticipantInput {
	return { participantType: "user", participantId: id };
}

const three = [user("alice"), user("bob"), user("carol")];
const amounts = (splits: Array<{ shareAmount: number }>) =>
	splits.map((s) => s.shareAmount);
const equal = (amount: number, currency: string) =>
	amounts(
		resolveSplits({
			mode: "EQUAL",
			amount,
			currency,
			participants: three,
			paidBy: payer,
		}),
	);

describe("resolveSplits in the currency's own minor units", () => {
	it("0.003 BTC split equally is 0.001 each, not 0", () => {
		expect(equal(0.003, "BTC")).toEqual([0.001, 0.001, 0.001]);
	});

	it("BTC remainders go to the payer in satoshis", () => {
		expect(equal(0.0000001, "BTC")).toEqual([0.00000004, 0.00000003, 0.00000003]);
	});

	it("ETH percentage and shares keep 8 decimals", () => {
		const pct = resolveSplits({
			mode: "PERCENTAGE",
			amount: 0.5,
			currency: "ETH",
			participants: [
				{ ...user("alice"), sharePercentage: 33.33 },
				{ ...user("bob"), sharePercentage: 66.67 },
			],
			paidBy: payer,
		});
		expect(amounts(pct)).toEqual([0.16665, 0.33335]);

		const shares = resolveSplits({
			mode: "SHARES",
			amount: 0.01,
			currency: "ETH",
			participants: [
				{ ...user("alice"), shareUnits: 1 },
				{ ...user("bob"), shareUnits: 2 },
			],
			paidBy: payer,
		});
		expect(amounts(shares)).toEqual([0.00333334, 0.00666666]);
	});

	it("KWD and BHD split in fils (3 decimals)", () => {
		expect(equal(10, "KWD")).toEqual([3.334, 3.333, 3.333]);
		expect(equal(1, "BHD")).toEqual([0.334, 0.333, 0.333]);
	});

	it("JPY splits in whole yen", () => {
		expect(equal(1000, "JPY")).toEqual([334, 333, 333]);
	});

	it("ARS and USD keep cents", () => {
		expect(equal(100000, "ARS")).toEqual([33333.34, 33333.33, 33333.33]);
		expect(equal(100, "USD")).toEqual([33.34, 33.33, 33.33]);
	});

	it("the even split summary uses the same units", () => {
		expect(evenSharePerPerson(0.003, 3, "BTC")).toBe(0.001);
		expect(evenSharePerPerson(10, 3, "KWD")).toBe(3.333);
		expect(evenSharePerPerson(1000, 3, "JPY")).toBe(333);
	});

	it("EXACT compares BTC shares to the satoshi", () => {
		expect(() =>
			resolveSplits({
				mode: "EXACT",
				amount: 0.003,
				currency: "BTC",
				participants: [
					{ ...user("alice"), shareAmount: 0.001 },
					{ ...user("bob"), shareAmount: 0.001 },
				],
				paidBy: payer,
			}),
		).toThrow(SplitComputationError);

		const ok = resolveSplits({
			mode: "EXACT",
			amount: 0.003,
			currency: "BTC",
			participants: [
				{ ...user("alice"), shareAmount: 0.0015 },
				{ ...user("bob"), shareAmount: 0.0015 },
			],
			paidBy: payer,
		});
		expect(amounts(ok)).toEqual([0.0015, 0.0015]);
	});
});
