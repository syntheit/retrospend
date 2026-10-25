import { describe, expect, it } from "vitest";
import {
	activityHref,
	filterOf,
	isNarrowed,
	readView,
	spanOf,
	writeView,
} from "./filter";

const TODAY = "2026-10-24";
const read = (qs: string) => readView(new URLSearchParams(qs), TODAY);

describe("the view in the URL", () => {
	it("a bare page is this month with nothing picked", () => {
		expect(read("")).toEqual({
			range: { from: "2026-10-01", to: "2026-10-31" },
			compare: false,
			cats: [],
			people: [],
			projects: [],
		});
		expect(writeView(read(""), TODAY)).toBe("");
	});

	it("reads dates, Compare and the chips", () => {
		const view = read(
			"from=2026-09-01&to=2026-09-30&compare=1&cat=a,b&person=user:x&project=p",
		);
		expect(view).toEqual({
			range: { from: "2026-09-01", to: "2026-09-30" },
			compare: true,
			cats: ["a", "b"],
			people: ["user:x"],
			projects: ["p"],
		});
		expect(writeView(view, TODAY)).toBe(
			"from=2026-09-01&to=2026-09-30&compare=1&cat=a%2Cb&person=user%3Ax&project=p",
		);
	});

	it("range=all is All time; a broken or backwards range is this month", () => {
		expect(read("range=all").range).toEqual({ from: null, to: null });
		expect(writeView(read("range=all"), TODAY)).toBe("range=all");
		expect(read("from=2026-13-40&to=2026-09-30").range.from).toBe("2026-10-01");
		expect(read("from=2026-10-09&to=2026-10-01").range.to).toBe("2026-10-31");
	});
});

describe("what the reads take", () => {
	it("All time starts at the oldest spending's day and ends today; with none it is today", () => {
		expect(spanOf({ from: null, to: null }, TODAY, "2025-03-04")).toEqual({
			from: "2025-03-04",
			to: TODAY,
		});
		expect(spanOf({ from: null, to: null }, TODAY, null)).toEqual({
			from: TODAY,
			to: TODAY,
		});
		expect(
			spanOf({ from: "2026-01-01", to: "2026-03-31" }, TODAY, "2025-03-04"),
		).toEqual({
			from: "2026-01-01",
			to: "2026-03-31",
		});
	});

	it("nothing picked sends no filter; picks send their ids", () => {
		expect(filterOf(read(""))).toEqual({});
		expect(isNarrowed(read(""))).toBe(false);
		const view = read("cat=a&person=shadow:p&project=q");
		expect(filterOf(view)).toEqual({
			categoryIds: ["a"],
			personKeys: ["shadow:p"],
			projectIds: ["q"],
		});
		expect(isNarrowed(view)).toBe(true);
	});
});

describe("links into Activity", () => {
	const view = read("from=2026-09-01&to=2026-09-30&cat=a&person=user:x");
	const params = (href: string) =>
		Object.fromEntries(new URL(href, "http://x").searchParams);

	it("carry the page's filters and range", () => {
		expect(params(activityHref(view, TODAY))).toEqual({
			from: "2026-09-01",
			to: "2026-09-30",
			cat: "a",
			person: "user:x",
		});
	});

	it("narrow to one category or move to another span", () => {
		expect(
			params(
				activityHref(view, TODAY, {
					cat: "z",
					span: { from: "2026-08-01", to: "2026-08-31" },
				}),
			),
		).toEqual({
			from: "2026-08-01",
			to: "2026-08-31",
			cat: "z",
			person: "user:x",
		});
	});

	it("this month with nothing picked is the bare Activity page", () => {
		expect(activityHref(read(""), TODAY)).toBe("/activity");
	});

	it("All time without a category says range=all", () => {
		expect(activityHref(read("range=all"), TODAY)).toBe("/activity?range=all");
	});
});
