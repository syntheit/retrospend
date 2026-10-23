/**
 * Checkpoints (SPEC §5.13): a pass started at a closed month's checkpoint
 * gives exactly the numbers of a full pass. Hand-derived book, start July,
 * today in October:
 *
 *   Jul  in 1000; food +300 -250 (Left 50, carries); fun +200 -150 (Left 50,
 *        Return: 50 back); save +100 (carries)
 *   Aug  food +100 -200, share -20 (Left -70); fun +200 -250 (Left -50);
 *        fronted 70 to a friend          -> overspent 120
 *   Sep  in 500; fun +200 -100 (Left 100, returns); save -60 to Wealth
 *        (Left 40); Everything else -40  -> overspent 40
 *   Oct  food +50 -30 (Left 20)
 *
 *   To assign Oct = 1500 - 1150 assigned - 160 overspent + 150 returned
 *                   - 70 fronted = 270; Σ Left Oct = 60; budget 330
 *   ledger        = 1500 - 1100 outflows - 70 = 330
 *   checkpoint Aug: carry { save: 100 }; running: in 1000, assigned 900,
 *                   overspent 120, returned 50, fronted 70
 */
import { describe, expect, it } from "vitest";
import {
	checkpointAt,
	fingerprints,
	summaryDiffers,
	toEngineCheckpoint,
} from "./checkpoint";
import {
	type ActivityEntry,
	computeBook,
	type EngineInput,
	invariantSides,
	sumLeft,
} from "./engine";
import { monthsFrom } from "./months";

const env = (id: string, rule: "CARRY" | "RETURN" = "CARRY") => ({
	id,
	kind: id === "save" ? ("SAVINGS" as const) : ("MONTHLY" as const),
	leftoverRule: rule,
	sweepToId: null,
	categoryIds: [`c-${id}`],
});

const act = (
	id: string,
	month: number,
	minor: number,
	cat: string | null,
	source: ActivityEntry["source"] = "SPENT",
	envelopeId: string | null = null,
): ActivityEntry => ({
	id,
	month,
	date: `${Math.floor(month / 100)}-${String(month % 100).padStart(2, "0")}-10`,
	minor,
	source,
	categoryId: cat,
	envelopeId,
});

const mv = (id: string, month: number, to: string, minor: number) => ({
	id,
	month,
	from: null,
	to,
	minor,
});

const input: EngineInput = {
	startMonth: 202607,
	currentMonth: 202610,
	defaultEnvelopeId: "else",
	envelopes: [env("food"), env("fun", "RETURN"), env("save"), env("else")],
	moneyIn: [
		{ id: "in1", month: 202607, minor: 1000, source: "INCOME" },
		{ id: "in2", month: 202609, minor: 500, source: "INCOME" },
	],
	movements: [
		mv("m1", 202607, "food", 300),
		mv("m2", 202607, "fun", 200),
		mv("m3", 202607, "save", 100),
		mv("m4", 202608, "food", 100),
		mv("m5", 202608, "fun", 200),
		mv("m6", 202609, "fun", 200),
		mv("m7", 202610, "food", 50),
	],
	activity: [
		act("e1", 202607, -250, "c-food"),
		act("e2", 202607, -150, "c-fun"),
		act("e3", 202608, -200, "c-food"),
		act("e4", 202608, -250, "c-fun"),
		act("sh1", 202608, -20, "c-food", "SHARE"),
		act("e5", 202609, -100, "c-fun"),
		act("e6", 202609, -40, null),
		act("w1", 202609, -60, null, "WEALTH", "save"),
		act("e7", 202610, -30, "c-food"),
	],
	splits: [
		{
			eventId: "f1",
			date: "2026-08-10",
			month: 202608,
			counterparty: "user:juan",
			currency: "USD",
			term: "FRONTED",
			minor: 70,
			fx: 0,
		},
	],
};

describe("engine checkpoints", () => {
	const full = computeBook(input);

	it("the full pass matches the hand-derived October and the invariant", () => {
		expect(full.toAssign(202610).total).toBe(270);
		expect(sumLeft(full, 202610)).toBe(60);
		const sides = invariantSides(input, full);
		expect(sides.budget).toBe(330);
		expect(sides.ledger).toBe(330);
	});

	it("the checkpoint at August holds the carry into September and the running totals", () => {
		const cp = checkpointAt(full, 202608, { missingRates: [], print: "p" });
		expect(cp.carry).toEqual({ save: 100 });
		expect(cp.totals).toEqual({
			moneyIn: 1000,
			assigned: 900,
			overspent: 120,
			returned: 50,
			fronted: 70,
			returnedByPeople: 0,
			forgiven: 0,
			oldDebtsPaid: 0,
		});
	});

	it("a pass from the August checkpoint gives the same September, October and November", () => {
		const cp = checkpointAt(full, 202608, { missingRates: [], print: "p" });
		const from = computeBook({
			...input,
			checkpoint: toEngineCheckpoint(cp),
			// Rows up to the checkpoint are not needed (the loader skips them).
			activity: input.activity.filter((a) => a.month > 202608),
			moneyIn: input.moneyIn.filter((a) => a.month > 202608),
			movements: input.movements.filter((a) => a.month > 202608),
		});
		expect(from.firstMonth).toBe(202609);
		for (const m of [202609, 202610, 202611]) {
			expect(from.toAssign(m)).toEqual(full.toAssign(m));
			expect([...from.month(m).envelopes.values()]).toEqual([
				...full.month(m).envelopes.values(),
			]);
		}
		expect(() => from.month(202608)).toThrow(RangeError);
	});

	it("rows dated before the checkpoint are ignored, not counted twice", () => {
		const cp = checkpointAt(full, 202608, { missingRates: [], print: "p" });
		const from = computeBook({ ...input, checkpoint: toEngineCheckpoint(cp) });
		expect(from.toAssign(202610).total).toBe(270);
	});

	it("a checkpoint for the current month is refused", () => {
		const cp = checkpointAt(full, 202609, { missingRates: [], print: "p" });
		expect(() =>
			computeBook({
				...input,
				checkpoint: { ...toEngineCheckpoint(cp), month: 202610 },
			}),
		).toThrow();
	});

	it("fingerprints change from the month a share changed on, not before", () => {
		const months = monthsFrom(202607, 202609);
		const before = fingerprints(input, months);
		const edited = fingerprints(
			{
				...input,
				activity: input.activity.map((a) =>
					a.id === "sh1" ? { ...a, minor: -25 } : a,
				),
			},
			months,
		);
		expect(edited.get(202607)).toBe(before.get(202607));
		expect(edited.get(202608)).not.toBe(before.get(202608));
		expect(edited.get(202609)).not.toBe(before.get(202609));
		// Own spending is guarded by budget_dirty marks, not the fingerprint.
		const spent = fingerprints(
			{
				...input,
				activity: input.activity.map((a) =>
					a.id === "e3" ? { ...a, minor: -1 } : a,
				),
			},
			months,
		);
		expect(spent.get(202609)).toBe(before.get(202609));
	});
});

describe("summaryDiffers", () => {
	const fun = {
		id: "fun",
		carryIn: 0,
		assigned: 200,
		activity: -100,
		left: 100,
		rule: "RETURN" as const,
		sweepToId: null,
		carried: 0,
		returned: 100,
		swept: 0,
		overspent: 0,
	};
	const base = {
		month: 202609,
		currency: "USD",
		moneyIn: 500,
		assigned: 200,
		overspent: 40,
		returned: 100,
		held: [],
		envelopes: [
			{
				id: "fun",
				carryIn: 0,
				assigned: 200,
				activity: -100,
				left: 100,
				rule: "RETURN" as const,
				sweepToId: null,
				carried: 0,
				returned: 100,
				swept: 0,
				overspent: 0,
			},
		],
	};

	it("an envelope added later with nothing in it is no change", () => {
		const later = {
			...base,
			envelopes: [
				...base.envelopes,
				{
					...fun,
					id: "new",
					assigned: 0,
					activity: 0,
					left: 0,
					returned: 0,
					rule: "CARRY" as const,
				},
			],
		};
		expect(summaryDiffers(base, later)).toBe(false);
	});

	it("a different Left is a change", () => {
		const changed = {
			...base,
			returned: 90,
			envelopes: [{ ...fun, activity: -110, left: 90 }],
		};
		expect(summaryDiffers(base, changed)).toBe(true);
	});
});
