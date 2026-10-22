import { describe, expect, it } from "vitest";
import {
	computeBook,
	type EngineInput,
	EngineInputError,
	invariantSides,
	sumLeft,
} from "./engine";

const m = (n: number) => n * 100;

function input(over: Partial<EngineInput> = {}): EngineInput {
	return {
		startMonth: 202609,
		currentMonth: 202610,
		defaultEnvelopeId: "else",
		envelopes: [
			{ id: "else", kind: "MONTHLY", leftoverRule: "CARRY", sweepToId: null, categoryIds: [] },
			{ id: "dining", kind: "MONTHLY", leftoverRule: "CARRY", sweepToId: null, categoryIds: ["c-din"] },
			{ id: "savings", kind: "SAVINGS", leftoverRule: "CARRY", sweepToId: null, categoryIds: [] },
		],
		moneyIn: [{ id: "sal", month: 202609, minor: m(1_000), source: "INCOME" }],
		activity: [],
		movements: [],
		splits: [],
		...over,
	};
}

const env = (id: string, rule: "CARRY" | "RETURN" | "SWEEP", sweepToId: string | null = null, kind: "MONTHLY" | "BILL" = "MONTHLY") => ({
	id,
	kind,
	leftoverRule: rule,
	sweepToId,
	categoryIds: id === "dining" ? ["c-din"] : [],
});

describe("engine leftovers (SPEC §5.5, §5.7)", () => {
	const sep = {
		movements: [{ id: "a", month: 202609, from: null, to: "dining", minor: m(300) }],
		activity: [{ id: "x", month: 202609, date: "2026-09-10", minor: -m(200), source: "SPENT" as const, categoryId: "c-din" }],
	};

	it("Carry: September's 100 left in Dining opens October", () => {
		const s = computeBook(input(sep));
		expect(s.month(202610).envelopes.get("dining")?.carryIn).toBe(m(100));
		expect(s.toAssign(202610).total).toBe(m(700));
	});

	it("Return: the 100 goes back to To assign and Dining opens at 0", () => {
		const i = input({ ...sep, envelopes: [env("else", "CARRY"), env("dining", "RETURN"), env("savings", "CARRY")] });
		const s = computeBook(i);
		expect(s.month(202610).envelopes.get("dining")?.carryIn).toBe(0);
		expect(s.toAssign(202610)).toMatchObject({ returned: m(100), total: m(800) });
		const sides = invariantSides(i, s);
		expect(sides.budget).toBe(sides.ledger);
	});

	it("Sweep: the 100 moves into Savings for October", () => {
		const i = input({ ...sep, envelopes: [env("else", "CARRY"), env("dining", "SWEEP", "savings"), env("savings", "CARRY")] });
		const s = computeBook(i);
		expect(s.month(202610).envelopes.get("dining")?.carryIn).toBe(0);
		expect(s.month(202610).envelopes.get("savings")?.carryIn).toBe(m(100));
		const sides = invariantSides(i, s);
		expect(sides.budget).toBe(sides.ledger);
	});

	it("Bills always carry, whatever the rule field says", () => {
		const i = input({ ...sep, envelopes: [env("else", "CARRY"), env("dining", "RETURN", null, "BILL"), env("savings", "CARRY")] });
		expect(computeBook(i).month(202610).envelopes.get("dining")?.carryIn).toBe(m(100));
	});

	it("an overspend resets to 0 and comes out of the next month's To assign (D4)", () => {
		const i = input({
			movements: [{ id: "a", month: 202609, from: null, to: "dining", minor: m(100) }],
			activity: [{ id: "x", month: 202609, date: "2026-09-10", minor: -m(150), source: "SPENT", categoryId: "c-din" }],
		});
		const s = computeBook(i);
		expect(s.month(202610).envelopes.get("dining")?.carryIn).toBe(0);
		expect(s.toAssign(202609).total).toBe(m(900));
		expect(s.toAssign(202610)).toMatchObject({ overspendTaken: m(50), total: m(850) });
		const sides = invariantSides(i, s);
		expect(sides.budget).toBe(sides.ledger);
	});
});

describe("engine activity routing", () => {
	it("unlinked and uncategorized rows land in the default envelope; pending and recurring are flagged", () => {
		const s = computeBook(
			input({
				activity: [
					{ id: "1", month: 202610, date: "2026-10-02", minor: -m(10), source: "SPENT", categoryId: null },
					{ id: "2", month: 202610, date: "2026-10-02", minor: -m(20), source: "SPENT", categoryId: "c-unlinked", recurring: true },
					{ id: "3", month: 202610, date: "2026-10-03", minor: -m(30), source: "SHARE", categoryId: "c-din", pending: true },
					{ id: "4", month: 202610, date: "2026-10-04", minor: m(5), source: "REFUND", categoryId: "c-din" },
				],
			}),
		);
		const oct = s.month(202610).envelopes;
		expect(oct.get("else")).toMatchObject({ activity: -m(30), recurring: -m(20) });
		expect(oct.get("dining")).toMatchObject({ activity: -m(25), pending: -m(30) });
	});

	it("rows before the book start are ignored (S20)", () => {
		const s = computeBook(
			input({ activity: [{ id: "old", month: 202608, date: "2026-08-30", minor: -m(99), source: "SPENT", categoryId: null }] }),
		);
		expect(sumLeft(s, 202610)).toBe(0);
	});

	it("runs one month past today and further when asked", () => {
		expect(computeBook(input()).months.map((x) => x.month)).toEqual([202609, 202610, 202611]);
		expect(computeBook(input(), 202612).months.at(-1)?.month).toBe(202612);
	});

	it("refuses a movement on an envelope the book does not have", () => {
		expect(() =>
			computeBook(input({ movements: [{ id: "a", month: 202610, from: null, to: "ghost", minor: 1 }] })),
		).toThrow(EngineInputError);
		expect(() => computeBook(input({ defaultEnvelopeId: "ghost" }))).toThrow(EngineInputError);
	});

	it("an envelope-to-envelope move leaves To assign alone", () => {
		const s = computeBook(
			input({
				movements: [
					{ id: "a", month: 202610, from: null, to: "dining", minor: m(400) },
					{ id: "b", month: 202610, from: "dining", to: "savings", minor: m(150) },
				],
			}),
		);
		expect(s.toAssign(202610).total).toBe(m(600));
		expect(s.month(202610).envelopes.get("savings")?.left).toBe(m(150));
	});
});
