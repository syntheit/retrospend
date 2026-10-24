/**
 * The correction plan, with every figure worked out by hand (MONEY-MOVES
 * 1.11). Electricidad: ARS 45,000, Sofía paid, shared by Sofía, Martín and
 * Juan, ARS 15,000 each. Amounts are minor units (ARS has 2 decimals).
 */
import { describe, expect, it } from "vitest";
import {
	CorrectionPlanError,
	differencesOf,
	type Party,
	planCorrection,
	type RowState,
} from "./plan";

const user = (participantId: string): Party => ({
	participantType: "user",
	participantId,
});
const sofia = user("sofia");
const martin = user("martin");
const juan = user("juan");

const share = (party: Party, minor: number) => ({ party, minor });

const original: RowState = {
	payer: sofia,
	categoryId: "utilities",
	amountMinor: 4_500_000,
	shares: [
		share(juan, 1_500_000),
		share(martin, 1_500_000),
		share(sofia, 1_500_000),
	],
};

const even = (amountMinor: number, ...people: Party[]) =>
	people.map((p) => share(p, amountMinor / people.length));

describe("planCorrection", () => {
	it("the bill was 48,000: one row, +3,000 paid by Sofía, +1,000 each", () => {
		const rows = planCorrection([original], {
			payer: sofia,
			categoryId: "utilities",
			amountMinor: 4_800_000,
			shares: even(4_800_000, sofia, martin, juan),
		});
		expect(rows).toEqual([
			{
				payer: sofia,
				categoryId: "utilities",
				amountMinor: 300_000,
				shares: [
					share(juan, 100_000),
					share(martin, 100_000),
					share(sofia, 100_000),
				],
			},
		]);
		expect(differencesOf(rows)).toEqual([
			{ party: juan, paidMinor: 0, shareMinor: 100_000 },
			{ party: martin, paidMinor: 0, shareMinor: 100_000 },
			{ party: sofia, paidMinor: 300_000, shareMinor: 100_000 },
		]);
	});

	it("wrong payer: Martín paid, not Sofía. Sofía's bucket reverses, Martín's arrives", () => {
		const rows = planCorrection([original], {
			payer: martin,
			categoryId: "utilities",
			amountMinor: 4_500_000,
			shares: original.shares,
		});
		expect(rows).toEqual([
			{
				payer: sofia,
				categoryId: "utilities",
				amountMinor: -4_500_000,
				shares: [
					share(juan, -1_500_000),
					share(martin, -1_500_000),
					share(sofia, -1_500_000),
				],
			},
			{
				payer: martin,
				categoryId: "utilities",
				amountMinor: 4_500_000,
				shares: [
					share(juan, 1_500_000),
					share(martin, 1_500_000),
					share(sofia, 1_500_000),
				],
			},
		]);
		// Sofía paid 45,000 less; Martín paid 45,000 more; nobody's share moved.
		expect(differencesOf(rows)).toEqual([
			{ party: martin, paidMinor: 4_500_000, shareMinor: 0 },
			{ party: sofia, paidMinor: -4_500_000, shareMinor: 0 },
		]);
	});

	it("a new category moves the whole split between categories, nothing else", () => {
		const rows = planCorrection([original], {
			payer: sofia,
			categoryId: "home",
			amountMinor: 4_500_000,
			shares: original.shares,
		});
		expect(rows.map((r) => [r.categoryId, r.amountMinor])).toEqual([
			["utilities", -4_500_000],
			["home", 4_500_000],
		]);
		expect(differencesOf(rows)).toEqual([]);
	});

	it("Juan was never there: 45,000 over two. Juan -15,000, the others +7,500, the amount unchanged", () => {
		const rows = planCorrection([original], {
			payer: sofia,
			categoryId: "utilities",
			amountMinor: 4_500_000,
			shares: even(4_500_000, sofia, martin),
		});
		expect(rows).toEqual([
			{
				payer: sofia,
				categoryId: "utilities",
				amountMinor: 0,
				shares: [
					share(juan, -1_500_000),
					share(martin, 750_000),
					share(sofia, 750_000),
				],
			},
		]);
	});

	it("a second correction is the difference from the first, not from the original", () => {
		const first: RowState = {
			payer: sofia,
			categoryId: "utilities",
			amountMinor: 300_000,
			shares: [
				share(juan, 100_000),
				share(martin, 100_000),
				share(sofia, 100_000),
			],
		};
		// It is 48,000 now; it was 46,500 after all: -1,500, -500 each.
		const rows = planCorrection([original, first], {
			payer: sofia,
			categoryId: "utilities",
			amountMinor: 4_650_000,
			shares: even(4_650_000, sofia, martin, juan),
		});
		expect(rows).toEqual([
			{
				payer: sofia,
				categoryId: "utilities",
				amountMinor: -150_000,
				shares: [
					share(juan, -50_000),
					share(martin, -50_000),
					share(sofia, -50_000),
				],
			},
		]);
	});

	it("no change plans no row", () => {
		expect(
			planCorrection([original], {
				payer: sofia,
				categoryId: "utilities",
				amountMinor: 4_500_000,
				shares: original.shares,
			}),
		).toEqual([]);
	});

	it("shares that do not add up to the amount are refused", () => {
		expect(() =>
			planCorrection([original], {
				payer: sofia,
				categoryId: "utilities",
				amountMinor: 4_800_000,
				shares: original.shares,
			}),
		).toThrow(CorrectionPlanError);
	});

	it("a negative share in the new state is refused (only correction rows go negative)", () => {
		expect(() =>
			planCorrection([original], {
				payer: sofia,
				categoryId: "utilities",
				amountMinor: 4_500_000,
				shares: [share(sofia, 5_000_000), share(martin, -500_000)],
			}),
		).toThrow(CorrectionPlanError);
	});
});
