import {
	envelopeActions,
	groupKey,
	groupLeft,
	groupPercents,
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
	({
		need: ars(5000),
		incomplete: false,
		foreign: null,
		...over,
	}) as BudgetEnvelope["target"];

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
		const noLimit = {
			totals: { left: ars(900), limitLeft: null },
		} as unknown as BudgetGroup;
		expect(groupLeft("LIMITS", noLimit)).toEqual(ars(900));
	});
});

describe("a % target group", () => {
	const target = (over: object) =>
		({
			target: {
				kind: "PERCENT_OF_INCOME",
				incomplete: false,
				plannedBp: 3000,
				spentBp: 3100,
				...over,
			},
		}) as unknown as BudgetGroup;

	it("says planned and spent as the server's basis points", () => {
		expect(groupPercents(target({}))).toEqual({
			plannedBp: 3000,
			spentBp: 3100,
		});
	});

	it("says nothing without an income to judge by or with a missing rate", () => {
		expect(groupPercents(target({ plannedBp: null }))).toBeNull();
		expect(groupPercents(target({ incomplete: true }))).toBeNull();
		expect(groupPercents({ target: null })).toBeNull();
		expect(groupPercents(target({ kind: "AMOUNT" }))).toBeNull();
	});
});

describe("the line under an envelope", () => {
	it("says Over and leaves how far to the Left on the same row", () => {
		expect(
			statusLine(envelope({ status: "OVERSPENT", left: ars(-2530) })),
		).toEqual({ kind: "over" });
	});

	it("a Weekly envelope says what is left this week, but over beats it", () => {
		const week = { amount: ars(7000) } as BudgetEnvelope["leftThisWeek"];
		expect(statusLine(envelope({ leftThisWeek: week }))).toEqual({
			kind: "week",
			amount: ars(7000),
		});
		expect(
			statusLine(envelope({ status: "OVERSPENT", leftThisWeek: week })),
		).toEqual({ kind: "over" });
	});

	it("says what an underfunded envelope still needs", () => {
		expect(
			statusLine(envelope({ status: "UNDERFUNDED", target: target() })),
		).toEqual({ kind: "needs", amount: ars(5000) });
		expect(
			statusLine(envelope({ status: "UNDERFUNDED", target: null })),
		).toBeNull();
	});

	it("says Funded only when there is a target", () => {
		expect(statusLine(envelope({ target: target() }))).toEqual({
			kind: "funded",
		});
		expect(statusLine(envelope({ status: "NO_TARGET" }))).toBeNull();
		expect(statusLine(envelope())).toBeNull();
	});

	it("a foreign target with no rate says so instead of a number", () => {
		const e = envelope({
			target: target({
				incomplete: true,
				foreign: { minor: 100, currency: "USD" },
			}),
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

	it("only the open month assigns, moves and covers what is over", () => {
		expect(envelopeActions(over, "FLEX", "open")).toEqual({
			assign: true,
			move: true,
			cover: true,
			limit: false,
		});
		expect(envelopeActions(envelope(), "FLEX", "open").cover).toBe(false);
	});

	it("planning the next month is on the web for now", () => {
		expect(envelopeActions(over, "FLEX", "next")).toEqual({
			assign: false,
			move: false,
			cover: false,
			limit: false,
		});
		expect(envelopeActions(over, "LIMITS", "next").limit).toBe(false);
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
			{
				envelopes: [
					envelope({ id: "a" }),
					envelope({ id: "b", status: "OVERSPENT" }),
				],
			},
			{ envelopes: [envelope({ id: "c", status: "OVERSPENT" })] },
		] as unknown as BudgetGroup[];
		expect(overEnvelopes({ groups }).map((e) => e.id)).toEqual(["b", "c"]);
	});
});
