// The contract package is ESM-only for jest; its filter parser has no imports.
import { parseActivityFilter } from "../../../../../packages/api-contract/src/expenses/filter";
import { DEFAULT_FILTER, filterString, isDefaultFilter } from "./filter";

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
			q: "café & té",
		});
		expect(text).toBe(
			"range=all&cat=cat1&person=user%3Aabc&kind=in&q=caf%C3%A9%20%26%20t%C3%A9",
		);
		expect(parseActivityFilter(text)).toEqual({
			ok: true,
			value: {
				rangeAll: true,
				categoryIds: ["cat1"],
				people: ["user:abc"],
				kinds: ["in"],
				q: "café & té",
			},
		});
	});
});
