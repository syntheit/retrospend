import { describe, expect, it } from "vitest";
import type { GlanceDTO } from "~/server/services/figures/glance";
import { lineOf, toGlanceVM, unnamedMissingRates } from "./glance-vm";

const ars = (minor: number) => ({ minor, currency: "ARS" });
const fig = (id: string, minor: number | null) => ({
	id,
	value: minor === null ? null : ars(minor),
});

const BASE: GlanceDTO = {
	home: "ARS",
	today: "2026-10-21",
	period: { from: "2026-10-01", to: "2026-10-31", days: 31, day: 21 },
	lastPeriod: { from: "2026-09-01", to: "2026-09-30", days: 30 },
	spent: fig("glance.spent", 270660200),
	spentLastToDate: fig("glance.spentLastToDate", 206565000),
	spentLast: fig("glance.spentLast", 383494000),
	pace: { this: [100, 300], last: [50, 150, 400], fasterThanLast: true },
	owedToYou: fig("owed.owedToYou", 166364300),
	youOwe: fig("owed.youOwe", 0),
	netWorth: fig("netWorth", 13532548300),
	budget: null,
	moneyIn: null,
	missingRates: [],
};

type Ready = Extract<NonNullable<GlanceDTO["budget"]>, { state: "ready" }>;

function ready(left: Partial<Ready["leftToSpend"]>, notPlanned = 85000000) {
	const zero = ars(0);
	return {
		state: "ready",
		verdict: {} as Ready["verdict"],
		leftToSpend: {
			left: ars(5916100),
			perDay: ars(537800),
			daysLeft: 11,
			carry: zero,
			assigned: zero,
			spent: zero,
			plannedTooMuch: zero,
			over: zero,
			billsHeld: zero,
			billsShort: zero,
			billsCount: 0,
			savings: zero,
			notPlanned: zero,
			fasterThanPlanned: true,
			...left,
		},
		notPlannedYet: fig("budget.notPlannedYet", notPlanned),
	} as Ready;
}

describe("toGlanceVM", () => {
	it("no book: the pace in words, money in, and no pace yet says No budget", () => {
		expect(toGlanceVM(BASE).line).toEqual({
			kind: "pace",
			faster: true,
			lastMonth: "2026-09-01",
		});
		const noPace = { ...BASE, pace: { ...BASE.pace, fasterThanLast: null } };
		expect(toGlanceVM(noPace).line).toEqual({ kind: "noBudget" });
		const track = toGlanceVM({
			...BASE,
			moneyIn: fig("glance.moneyIn", 50000000),
		});
		expect(track.rows.at(-1)).toEqual({
			id: "moneyIn",
			amount: ars(50000000),
			href: "/activity?kind=in",
			figure: "glance.moneyIn",
		});
	});

	it("no book: the rows with a value, zero left out", () => {
		const vm = toGlanceVM(BASE);
		expect(vm.spent).toEqual(ars(270660200));
		expect(vm.spentFigure).toBe("glance.spent");
		expect(vm.month).toBe("2026-10-01");
		expect(vm.fasterThanPlanned).toBe(false);
		expect(vm.rows.map((r) => [r.id, r.figure, r.href])).toEqual([
			["owedToYou", "owed.owedToYou", "/people"],
			["netWorth", "netWorth", "/wealth"],
		]);
		expect(vm.pace).toEqual({
			currency: "ARS",
			current: [100, 300],
			previous: [50, 150, 400],
			days: 31,
		});
	});

	it("a ready budget: the per-day line, the pace word and Not planned yet first", () => {
		const vm = toGlanceVM({ ...BASE, budget: ready({}) });
		expect(vm.line).toEqual({
			kind: "perDay",
			perDay: ars(537800),
			daysLeft: 11,
		});
		expect(vm.fasterThanPlanned).toBe(true);
		expect(vm.rows[0]).toEqual({
			id: "toAssign",
			amount: ars(85000000),
			href: "/budget",
			figure: "budget.notPlannedYet",
		});
	});

	it("over plan reads the server's over figure; the last day says left today", () => {
		expect(lineOf({ ...BASE, budget: ready({ over: ars(4840000) }) })).toEqual({
			kind: "over",
			over: ars(4840000),
		});
		expect(lineOf({ ...BASE, budget: ready({ daysLeft: 1 }) })).toEqual({
			kind: "leftToday",
			left: ars(5916100),
		});
	});

	it("a missing rate: spent stays null and the budget line names the currencies", () => {
		const dto: GlanceDTO = {
			...BASE,
			spent: fig("glance.spent", null),
			owedToYou: fig("owed.owedToYou", null),
			budget: { state: "incomplete", missingRates: ["BRL"] },
			missingRates: ["BRL", "CLP"],
		};
		const vm = toGlanceVM(dto);
		expect(vm.spent).toBeNull();
		expect(vm.line).toEqual({ kind: "unavailable", currencies: ["BRL"] });
		// The row stays and says "No rate yet" (R14); zero rows still go.
		expect(vm.rows.map((r) => [r.id, r.amount])).toEqual([
			["owedToYou", null],
			["netWorth", ars(13532548300)],
		]);
		expect(unnamedMissingRates(dto, [])).toEqual(["CLP"]);
		expect(unnamedMissingRates(dto, ["CLP"])).toEqual([]);
	});

	it("a currency a Needs you item names is not named again on the line", () => {
		const dto: GlanceDTO = {
			...BASE,
			budget: { state: "incomplete", missingRates: ["BRL", "CLP"] },
		};
		expect(toGlanceVM(dto, { named: ["BRL"] }).line).toEqual({
			kind: "unavailable",
			currencies: ["CLP"],
		});
		expect(lineOf(dto, ["BRL", "CLP"])).toEqual({
			kind: "unavailable",
			currencies: [],
		});
	});

	it("owed rows carry the faces behind them", () => {
		const lucia = { id: "user:lucia", name: "Lucía Fernández" };
		const vm = toGlanceVM(
			{ ...BASE, youOwe: fig("owed.youOwe", 1796981) },
			{ faces: { owedToYou: [lucia], youOwe: [] } },
		);
		expect(vm.rows.find((r) => r.id === "owedToYou")?.faces).toEqual([lucia]);
		expect(vm.rows.find((r) => r.id === "youOwe")?.faces).toBeUndefined();
	});

	it("a new user: no pace yet, zero spent, no rows", () => {
		const vm = toGlanceVM({
			...BASE,
			spent: fig("glance.spent", 0),
			pace: { this: [0, 0, 0], last: [0, 0, 0, 0], fasterThanLast: false },
			owedToYou: fig("owed.owedToYou", 0),
			netWorth: fig("netWorth", 0),
		});
		expect(vm.spent).toEqual(ars(0));
		expect(vm.pace.current).toEqual([]);
		expect(vm.pace.previous).toEqual([]);
		expect(vm.rows).toEqual([]);
	});

	it("nothing yet this month but spending last month: both lines draw", () => {
		const vm = toGlanceVM({
			...BASE,
			pace: { this: [0, 0], last: [0, 500, 900], fasterThanLast: false },
		});
		expect(vm.pace.current).toEqual([0, 0]);
		expect(vm.pace.previous).toEqual([0, 500, 900]);
	});
});
