import { describe, expect, it } from "vitest";
import { prepareRows } from "./prepare";
import type { StoredRow } from "./rows";

const row = (over: Partial<StoredRow>): StoredRow =>
	Object.assign(
		{ title: "Coffee", amount: 100, currency: "ARS", date: "2026-10-05" },
		over,
	) as StoredRow;

describe("prepareRows text", () => {
	it("cleans a title and keeps the row", () => {
		const out = prepareRows([row({ title: "  Cof\u000bfee " })], {});
		expect(out.rows.map((r) => r.title)).toEqual(["Coffee"]);
		expect(out.badText).toBe(0);
	});

	it("refuses a row whose title, location or description starts with U+0001", () => {
		const sealed = "\u0001k1:AAAA";
		const out = prepareRows(
			[
				row({ title: "Ok" }),
				row({ title: sealed }),
				row({ title: "Loc", location: sealed }),
				row({ title: "Desc", description: sealed }),
				row({ title: "Fine", location: "BA", description: "x" }),
			],
			{},
		);
		expect(out.rows.map((r) => [r.index, r.title])).toEqual([
			[0, "Ok"],
			[4, "Fine"],
		]);
		expect(out.badText).toBe(3);
		expect(out.badDates).toBe(0);
	});

	it("counts a bad date and sealed text separately", () => {
		const out = prepareRows(
			[row({ date: "not a day" }), row({ title: "\u0001k1:AAAA" })],
			{},
		);
		expect(out).toMatchObject({ badDates: 1, badText: 1 });
		expect(out.rows).toEqual([]);
	});
});
