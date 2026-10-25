import {
	envelopeActions,
	groupKey,
	groupLeft,
	groupStartsOpen,
	overEnvelopes,
	statusLine,
} from "./rows";
import type { BudgetEnvelope, BudgetGroup } from "./source";

const ars = (minor: number) => ({ minor, currency: "ARS" });

function envelope(over: Partial<BudgetEnvelope> = {}): BudgetEnvelope {
	return {
		id: "e1",
		name: "Cafe",
		status: "FUNDED",
		left: ars(1000),
		target: null,
		...over,
	} as BudgetEnvelope;
}

const target = (over: object = {}) =>
	({ need: ars(5000), incomplete: false, foreign: null, ...over }) as BudgetEnvelope["target"];

describe("group folding", () => {
	it("Flex and Save first fold every group, Weekly opens Spending only", () => {
		expect(groupStartsOpen("FLEX", { role: "BILLS" })).toBe(false);
		expect(groupStartsOpen("SAVE_FIRST", { role: "SPENDING" })).toBe(false);
		expect(groupStartsOpen("WEEKLY", { role: "SPENDING" })).toBe(true);
		expect(groupStartsOpen("WEEKLY", { role: "BILLS" })).toBe(false);
		expect(groupStartsOpen("EVERY_DOLLAR", { role: "BILLS" })).toBe(true);
		expect(groupStartsOpen("LIMITS", { role: null })).toBe(true);
	});

	it("names a group without an id 'none'", () => {
		expect(groupKey({ id: null })).toBe("none");
		expect(groupKey({ id: "g1" })).toBe("g1");
	});

	it("Limits counts only the envelopes that have a limit in a group's Left", () => {
		const group = {
			totals: { left: ars(900), limitLeft: ars(400) },
		} as unknown as BudgetGroup;
		expect(groupLeft("LIMITS", group)).toEqual(ars(400));
		expect(groupLeft("FLEX", group)).toEqual(ars(900));
		const noLimit = { totals: { left: ars(900), limitLeft: null } } as unknown as BudgetGroup;
		expect(groupLeft("LIMITS", noLimit)).toEqual(ars(900));
	});
});

describe("the line under an envelope", () => {
	it("says Over by with the amount it is over", () => {
		expect(statusLine(envelope({ status: "OVERSPENT", left: ars(-2530) }))).toEqual({
			kind: "over",
			amount: ars(-2530),
		});
	});

	it("says what an underfunded envelope still needs", () => {
		expect(
			statusLine(envelope({ status: "UNDERFUNDED", target: target() })),
		).toEqual({ kind: "needs", amount: ars(5000) });
		expect(statusLine(envelope({ status: "UNDERFUNDED", target: null }))).toBeNull();
	});

	it("says Funded only when there is a target", () => {
		expect(statusLine(envelope({ target: target() }))).toEqual({ kind: "funded" });
		expect(statusLine(envelope({ status: "NO_TARGET" }))).toBeNull();
		expect(statusLine(envelope())).toBeNull();
	});

	it("a foreign target with no rate says so instead of a number", () => {
		const e = envelope({
			target: target({ incomplete: true, foreign: { minor: 100, currency: "USD" } }),
		});
		expect(statusLine(e)).toEqual({ kind: "noRate", currency: "USD" });
	});
});

describe("what a tap on an envelope can do", () => {
	const over = envelope({ status: "OVERSPENT" });
	it("a closed month is read-only", () => {
		expect(envelopeActions(over, "EVERY_DOLLAR", "closed")).toEqual({
			assign: false,
			move: false,
			cover: false,
			limit: false,
		});
	});

	it("an open month assigns, moves and covers what is over", () => {
		expect(envelopeActions(over, "FLEX", "open")).toEqual({
			assign: true,
			move: true,
			cover: true,
			limit: false,
		});
		expect(envelopeActions(envelope(), "FLEX", "open").cover).toBe(false);
	});

	it("the next month can be planned but has nothing to cover", () => {
		const next = envelopeActions(over, "FLEX", "next");
		expect(next.assign).toBe(true);
		expect(next.cover).toBe(false);
	});

	it("Limits edits the limit and nothing else", () => {
		expect(envelopeActions(over, "LIMITS", "open")).toEqual({
			assign: false,
			move: false,
			cover: false,
			limit: true,
		});
	});
});

describe("over envelopes", () => {
	it("lists them in group order", () => {
		const groups = [
			{ envelopes: [envelope({ id: "a" }), envelope({ id: "b", status: "OVERSPENT" })] },
			{ envelopes: [envelope({ id: "c", status: "OVERSPENT" })] },
		] as unknown as BudgetGroup[];
		expect(overEnvelopes({ groups }).map((e) => e.id)).toEqual(["b", "c"]);
	});
});
