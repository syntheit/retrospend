import {
	envelopeSpentPercent,
	groupSpentPercent,
	leftAtom,
	targetLine,
} from "./envelopeLine";
import type { BudgetEnvelope, BudgetGroup } from "./source";

const ars = (minor: number) => ({ minor, currency: "ARS" });
const usd = (minor: number) => ({ minor, currency: "USD" });

type Target = NonNullable<BudgetEnvelope["target"]>;
const target = (over: Partial<Target> = {}) =>
	({
		kind: "MONTHLY",
		cadence: "MONTH",
		amount: ars(30000),
		need: ars(0),
		dueDate: null,
		progress: null,
		foreign: null,
		incomplete: false,
		...over,
	}) as Target;

describe("target line", () => {
	it("says there is no target when the envelope has none", () => {
		expect(targetLine({ target: null })).toEqual({ kind: "none" });
	});

	it("says a target with no rate yet, with no figure", () => {
		expect(
			targetLine({
				target: target({ incomplete: true, foreign: usd(200) }),
			}),
		).toEqual({ kind: "noRate", currency: "USD" });
	});

	it("keeps a monthly or weekly amount and the target as set in another currency", () => {
		expect(targetLine({ target: target() })).toEqual({
			kind: "monthly",
			cadence: "MONTH",
			amount: ars(30000),
			foreign: null,
		});
		expect(
			targetLine({ target: target({ cadence: "WEEK", foreign: usd(20) }) }),
		).toEqual({
			kind: "monthly",
			cadence: "WEEK",
			amount: ars(30000),
			foreign: usd(20),
		});
	});

	it("reads a bill with its due date and a goal with what is saved", () => {
		expect(
			targetLine({ target: target({ kind: "BILL", dueDate: "2026-11-05" }) }),
		).toMatchObject({ kind: "bill", dueDate: "2026-11-05" });
		expect(
			targetLine({
				target: target({
					kind: "SAVINGS",
					progress: ars(5000),
					dueDate: "2027-01-01",
				}),
			}),
		).toMatchObject({ kind: "goal", saved: ars(5000), dueDate: "2027-01-01" });
	});
});

describe("Left at the end of a row", () => {
	const row = (over: Partial<BudgetEnvelope>) =>
		({
			status: "FUNDED",
			left: ars(1000),
			target: null,
			...over,
		}) as BudgetEnvelope;

	it("is a pill that says how far over for an overspent envelope", () => {
		expect(leftAtom(row({ status: "OVERSPENT", left: ars(-300) }))).toEqual({
			kind: "over",
			amount: ars(-300),
		});
	});

	it("shows what is still needed under a short envelope's Left", () => {
		expect(
			leftAtom(
				row({
					status: "UNDERFUNDED",
					target: target({ need: ars(700) }),
				}),
			),
		).toEqual({ kind: "needed", left: ars(1000), need: ars(700) });
	});

	it("is a plain amount otherwise, quiet at zero", () => {
		expect(leftAtom(row({}))).toEqual({
			kind: "plain",
			left: ars(1000),
			zero: false,
		});
		expect(leftAtom(row({ left: ars(0) }))).toMatchObject({ zero: true });
		expect(
			leftAtom(row({ status: "UNDERFUNDED", target: null })),
		).toMatchObject({ kind: "plain" });
	});
});

describe("bars", () => {
	it("draws a group's spent share of what it holds, capped at the whole bar", () => {
		const totals = (carry: number, assigned: number, spent: number) =>
			({
				carryIn: ars(carry),
				assigned: ars(assigned),
				spent: ars(spent),
			}) as BudgetGroup["totals"];
		expect(groupSpentPercent(totals(0, 10000, 2500))).toBe(25);
		expect(groupSpentPercent(totals(1000, 9000, 15000))).toBe(100);
		expect(groupSpentPercent(totals(0, 0, 500))).toBeNull();
	});

	it("takes an envelope's bar from the server's basis points", () => {
		expect(envelopeSpentPercent({ spentBasis: 4250 })).toBe(42.5);
		expect(envelopeSpentPercent({ spentBasis: null })).toBeNull();
	});
});
