// The contract package is ESM-only for jest; its filter parser has no imports.
import { parseActivityFilter } from "../../../../../packages/api-contract/src/expenses/filter";
import {
	DEFAULT_FILTER,
	effectivePeriod,
	filterString,
	isDefaultFilter,
} from "./filter";

describe("effectivePeriod", () => {
	it("is this month by default and all time when a search or category widens it", () => {
		expect(effectivePeriod(DEFAULT_FILTER)).toBe("month");
		expect(effectivePeriod({ ...DEFAULT_FILTER, categoryId: "c1" })).toBe(
			"all",
		);
		expect(effectivePeriod({ ...DEFAULT_FILTER, q: "cafe" })).toBe("all");
		expect(effectivePeriod({ ...DEFAULT_FILTER, period: "all" })).toBe("all");
	});

	it("keeps this month when it was asked for, and sends it as dates", () => {
		const filter = { ...DEFAULT_FILTER, period: "thisMonth" as const };
		expect(effectivePeriod({ ...filter, categoryId: "c1" })).toBe("month");
		const now = new Date(2026, 1, 10);
		expect(filterString({ ...filter, categoryId: "c1" }, now)).toBe(
			"from=2026-02-01&to=2026-02-28&cat=c1",
		);
		expect(filterString(filter, now)).toBe("");
	});
});

describe("filterString", () => {
	it("is empty for the default (this month, everything)", () => {
		expect(filterString(DEFAULT_FILTER)).toBe("");
		expect(isDefaultFilter(DEFAULT_FILTER)).toBe(true);
	});

	it("writes the web's grammar, which the server's parser reads back", () => {
		const text = filterString({
			period: "all",
			kind: "in",
			categoryId: "cat1",
			personKey: "user:abc",
			projectId: "proj1",
			q: "café & té",
		});
		expect(text).toBe(
			"range=all&cat=cat1&person=user%3Aabc&project=proj1&kind=in&q=caf%C3%A9%20%26%20t%C3%A9",
		);
		expect(parseActivityFilter(text)).toEqual({
			ok: true,
			value: {
				rangeAll: true,
				categoryIds: ["cat1"],
				people: ["user:abc"],
				projectIds: ["proj1"],
				kinds: ["in"],
				q: "café & té",
			},
		});
	});
});
