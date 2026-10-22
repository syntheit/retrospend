import { describe, expect, it } from "vitest";
import { currencyGroups } from "./currency-picker";
import { choiceOf } from "./date-picker";
import {
	completeRange,
	drawnRange,
	initialLeft,
	leftToShow,
	type LabelFormat,
	pickDay,
	presetOf,
	presets,
	previousPeriod,
	rangeLabel,
	visibleMonths,
} from "./date-range-model";
import {
	addMonths,
	isIsoDate,
	lastOfMonth,
	monthCells,
	moveDay,
	parseTypedDate,
	weekdayOrder,
} from "./dates";
import { fold, pickerFilter, splitRecent } from "./match";
import { dayState } from "./month-grid";
import { togglePerson } from "./person-picker";

const TODAY = "2026-10-22"; // a Thursday

describe("dates", () => {
	it("validates real calendar days only", () => {
		expect(isIsoDate("2026-02-28")).toBe(true);
		expect(isIsoDate("2026-02-29")).toBe(false);
		expect(isIsoDate("2028-02-29")).toBe(true);
		expect(isIsoDate("2026-13-01")).toBe(false);
	});

	it("month math crosses years and month lengths", () => {
		expect(addMonths("2026-01-31", -1)).toBe("2025-12-01");
		expect(addMonths("2026-11-15", 2)).toBe("2027-01-01");
		expect(lastOfMonth("2026-02-10")).toBe("2026-02-28");
	});

	it("a month grid starts on the locale's week start", () => {
		// Oct 1 2026 is a Thursday: 4 blanks from Sunday, 3 from Monday.
		const sun = monthCells("2026-10-01", 0);
		const mon = monthCells("2026-10-01", 1);
		expect(sun.slice(0, 5)).toEqual([null, null, null, null, "2026-10-01"]);
		expect(mon.filter((c) => c === null)).toHaveLength(3);
		expect(sun.filter(Boolean)).toHaveLength(31);
		expect(weekdayOrder(1)).toEqual([1, 2, 3, 4, 5, 6, 0]);
	});

	it("grid keys move by day, week, week end and month", () => {
		const k = (key: string, shiftKey = false) =>
			moveDay(TODAY, { key, shiftKey }, 0);
		expect(k("ArrowLeft")).toBe("2026-10-21");
		expect(k("ArrowRight")).toBe("2026-10-23");
		expect(k("ArrowUp")).toBe("2026-10-15");
		expect(k("ArrowDown")).toBe("2026-10-29");
		expect(k("Home")).toBe("2026-10-18");
		expect(k("End")).toBe("2026-10-24");
		expect(k("PageUp")).toBe("2026-09-22");
		expect(k("PageDown", true)).toBe("2027-10-22");
		expect(moveDay("2026-03-31", { key: "PageUp" }, 0)).toBe("2026-02-28");
		expect(moveDay(TODAY, { key: "Home" }, 1)).toBe("2026-10-19");
		expect(k("a")).toBeNull();
	});

	it("reads typed dates in the locale's digit order", () => {
		expect(parseTypedDate("10/5/2026", "en")).toBe("2026-10-05");
		expect(parseTypedDate("5/10/2026", "es-AR")).toBe("2026-10-05");
		expect(parseTypedDate("05.10.26", "de")).toBe("2026-10-05");
		expect(parseTypedDate("2026-10-05", "fr")).toBe("2026-10-05");
		expect(parseTypedDate("", "en")).toBe("");
		expect(parseTypedDate("31/02/2026", "es")).toBeNull();
		expect(parseTypedDate("tomorrow", "en")).toBeNull();
	});
});

const fmt: LabelFormat = {
	month: (iso) => `M:${iso.slice(0, 7)}`,
	short: (iso) => `S:${iso.slice(5)}`,
	long: (iso) => `L:${iso}`,
	preset: (id) => `P:${id}`,
	span: (a, b) => `${a} to ${b}`,
	start: "Start",
	today: "today",
};

describe("date range", () => {
	it("presets are computed from today", () => {
		const p = Object.fromEntries(
			presets(TODAY).map((x) => [x.id, [x.from, x.to]]),
		);
		expect(p.thisMonth).toEqual(["2026-10-01", "2026-10-31"]);
		expect(p.lastMonth).toEqual(["2026-09-01", "2026-09-30"]);
		expect(p.last30).toEqual(["2026-09-23", "2026-10-22"]);
		expect(p.last90).toEqual(["2026-07-25", "2026-10-22"]);
		expect(p.lastYear).toEqual(["2025-01-01", "2025-12-31"]);
		expect(p.allTime).toEqual([null, null]);
		expect(presetOf({ from: "2026-09-23", to: TODAY }, TODAY)).toBe("last30");
	});

	it("click start, click end, either order; a third click starts over", () => {
		let r = pickDay({ from: null, to: null }, "2026-10-18");
		expect(r).toEqual({ from: "2026-10-18", to: null });
		r = pickDay(r, "2026-10-05");
		expect(r).toEqual({ from: "2026-10-05", to: "2026-10-18" });
		expect(pickDay(r, "2026-10-09")).toEqual({ from: "2026-10-09", to: null });
	});

	it("hover previews the end while picking", () => {
		expect(drawnRange({ from: "2026-10-10", to: null }, "2026-10-04")).toEqual({
			lo: "2026-10-04",
			hi: "2026-10-10",
			preview: true,
		});
		expect(
			drawnRange({ from: "2026-10-01", to: "2026-10-03" }, "2026-10-20")
				.preview,
		).toBe(false);
		expect(completeRange({ from: "2026-10-10", to: null })).toEqual({
			from: "2026-10-10",
			to: "2026-10-10",
		});
	});

	it("compare: the previous month for a month, else the same number of days before", () => {
		expect(previousPeriod({ from: "2026-03-01", to: "2026-03-31" })).toEqual({
			from: "2026-02-01",
			to: "2026-02-28",
		});
		// Oct 5 to Oct 18 is 14 days; the 14 days before are Sep 21 to Oct 4.
		expect(previousPeriod({ from: "2026-10-05", to: "2026-10-18" })).toEqual({
			from: "2026-09-21",
			to: "2026-10-04",
		});
		expect(previousPeriod({ from: null, to: null })).toBeNull();
	});

	it("labels: whole month, whole year, preset, else a span", () => {
		expect(
			rangeLabel({ from: "2026-10-01", to: "2026-10-31" }, TODAY, fmt),
		).toBe("M:2026-10");
		expect(
			rangeLabel({ from: "2025-01-01", to: "2025-12-31" }, TODAY, fmt),
		).toBe("2025");
		expect(rangeLabel({ from: "2026-09-23", to: TODAY }, TODAY, fmt)).toBe(
			"P:last30",
		);
		expect(rangeLabel({ from: null, to: null }, TODAY, fmt)).toBe("P:allTime");
		expect(
			rangeLabel({ from: "2026-09-22", to: "2026-10-21" }, TODAY, fmt),
		).toBe("S:09-22 to S:10-21");
		expect(rangeLabel({ from: "2025-12-20", to: null }, TODAY, fmt)).toBe(
			"L:2025-12-20 to today",
		);
	});

	it("the calendar pages just enough to show a focused day", () => {
		expect(initialLeft({ from: null, to: TODAY }, TODAY, 2)).toBe("2026-09-01");
		expect(visibleMonths("2026-09-01", 2)).toEqual([
			"2026-09-01",
			"2026-10-01",
		]);
		expect(leftToShow("2026-10-31", "2026-09-01", 2)).toBe("2026-09-01");
		expect(leftToShow("2026-11-01", "2026-09-01", 2)).toBe("2026-10-01");
		expect(leftToShow("2026-08-31", "2026-09-01", 2)).toBe("2026-08-01");
	});

	it("day states: ends, inside, today, preview", () => {
		const p = { lo: "2026-10-05", hi: "2026-10-09", today: TODAY };
		expect(dayState("2026-10-05", p)).toMatchObject({
			end: true,
			inside: false,
		});
		expect(dayState("2026-10-07", p)).toMatchObject({
			end: false,
			inside: true,
		});
		expect(dayState(TODAY, p)).toMatchObject({ today: true, inside: false });
		expect(dayState("2026-10-07", { ...p, preview: true }).preview).toBe(true);
	});
});

describe("DatePicker choice", () => {
	it("Today and Yesterday are presets; anything else is a picked day", () => {
		expect(choiceOf(TODAY, TODAY)).toBe("today");
		expect(choiceOf("2026-10-21", TODAY)).toBe("yesterday");
		expect(choiceOf("2026-10-01", TODAY)).toBe("other");
	});
});

describe("list pickers", () => {
	it("search ignores case and accents", () => {
		expect(fold("  Lucía ")).toBe("lucia");
		expect(pickerFilter("p1", "LUCIA", ["Lucía Pérez"])).toBe(1);
		expect(pickerFilter("c1", "cafe", ["Café"])).toBe(1);
		expect(pickerFilter("c1", "uber", ["Café"])).toBe(0);
		expect(pickerFilter("c1", "", ["Café"])).toBe(1);
	});

	it("recents first, in their order, once; unknown ids dropped", () => {
		const items = ["a", "b", "c", "d"].map((id) => ({ id }));
		const { recent, rest } = splitRecent(items, ["c", "x", "a", "c"]);
		expect(recent.map((i) => i.id)).toEqual(["c", "a"]);
		expect(rest.map((i) => i.id)).toEqual(["b", "d"]);
	});

	it("currencies: favorites, then recents not already favorites, then the rest", () => {
		const all = ["ARS", "USD", "BRL", "EUR"].map((id) => ({ id, name: id }));
		const g = currencyGroups(all, ["USD"], ["USD", "BRL", "XXX"]);
		expect(g.fav.map((c) => c.id)).toEqual(["USD"]);
		expect(g.recent.map((c) => c.id)).toEqual(["BRL"]);
		expect(g.rest.map((c) => c.id)).toEqual(["ARS", "EUR"]);
	});

	it("selecting a person toggles them and keeps the order", () => {
		expect(togglePerson(["a", "b"], "c")).toEqual(["a", "b", "c"]);
		expect(togglePerson(["a", "b", "c"], "b")).toEqual(["a", "c"]);
	});
});
