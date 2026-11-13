import { describe, expect, it } from "vitest";
import { rescaleExactSplits } from "./exact-rescale";

const ana = { participantType: "user" as const, participantId: "ana" };
const bob = { participantType: "user" as const, participantId: "bob" };
const equal = () => {
	throw new Error("the equal fallback is not expected here");
};

const rescale = (input: {
	oldAmount: number;
	newAmount: number;
	currency: string;
	fromCurrency: string;
	shares: [number, number];
	paidBy?: typeof ana;
}) =>
	rescaleExactSplits({
		oldAmount: input.oldAmount,
		newAmount: input.newAmount,
		currency: input.currency,
		fromCurrency: input.fromCurrency,
		splits: [
			{ ...ana, shareAmount: input.shares[0] },
			{ ...bob, shareAmount: input.shares[1] },
		],
		paidBy: input.paidBy ?? ana,
		equal,
	}).map((s) => s.shareAmount);

describe("rescaleExactSplits", () => {
	it("keeps each share's fraction and gives the leftover cent to the payer", () => {
		// 2.00 : 1.00 = 200 : 100 weights over 100.00 = 10000 cents:
		// floor(10000 x 200 / 300) = 6666, floor(10000 x 100 / 300) = 3333,
		// 1 left for Ana (the payer): 66.67 + 33.33.
		expect(
			rescale({
				oldAmount: 3,
				newAmount: 100,
				currency: "USD",
				fromCurrency: "USD",
				shares: [2, 1],
			}),
		).toEqual([66.67, 33.33]);
	});

	it("a new total that is a tie rounds half to even before it is split", () => {
		// 0.285 USD is 28.5 cents: half even gives 28 (half up would give 29).
		// Weights 50 : 50 over 28 cents is 14 + 14.
		expect(
			rescale({
				oldAmount: 1,
				newAmount: 0.285,
				currency: "USD",
				fromCurrency: "USD",
				shares: [0.5, 0.5],
			}),
		).toEqual([0.14, 0.14]);
	});

	it("an edit that changes the currency rescales in the new currency's units", () => {
		// USD shares 2.00 : 1.00 (200 : 100) over JPY 1257.5, a tie that half
		// even takes to the even 1258. floor(1258 x 200 / 300) = 838 and
		// floor(1258 x 100 / 300) = 419, 1 left for Ana: 839 + 419 yen.
		expect(
			rescale({
				oldAmount: 3,
				newAmount: 1257.5,
				currency: "JPY",
				fromCurrency: "USD",
				shares: [2, 1],
			}),
		).toEqual([839, 419]);
	});

	it("the weights are the old shares read half even in the old currency", () => {
		// ARS shares 0.285 and 0.295 are 28.5 and 29.5 centavos: half even is
		// 28 and 30. Over 0.58 (58 cents) the weights 28 : 30 give 28 and 30.
		expect(
			rescale({
				oldAmount: 0.58,
				newAmount: 0.58,
				currency: "ARS",
				fromCurrency: "ARS",
				shares: [0.285, 0.295],
			}),
		).toEqual([0.28, 0.3]);
	});

	it("falls back to the equal split when the old total was zero", () => {
		const out = rescaleExactSplits({
			oldAmount: 0,
			newAmount: 10,
			currency: "USD",
			fromCurrency: "USD",
			splits: [
				{ ...ana, shareAmount: 0 },
				{ ...bob, shareAmount: 0 },
			],
			paidBy: ana,
			equal: () => [
				{ ...ana, shareAmount: 5 },
				{ ...bob, shareAmount: 5 },
			],
		});
		expect(out.map((s) => s.shareAmount)).toEqual([5, 5]);
	});
});
