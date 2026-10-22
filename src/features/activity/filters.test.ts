import { describe, expect, it } from "vitest";
import { queryOf, readFilter, toggled, writeFilter } from "./filters";

const TODAY = "2026-10-21";
const read = (qs: string) => readFilter(new URLSearchParams(qs), TODAY);

describe("Activity filter in the URL", () => {
	it("defaults to this month and writes it as the bare page", () => {
		const f = read("");
		expect(f.range).toEqual({ from: "2026-10-01", to: "2026-10-31" });
		expect(writeFilter(f, TODAY)).toBe("");
	});

	it("covers every month for a search or a category link (RC-10)", () => {
		expect(read("q=almacen").range).toEqual({ from: null, to: null });
		expect(read("cat=c1,c2").range).toEqual({ from: null, to: null });
		expect(writeFilter(read("q=almacen"), TODAY)).toBe("q=almacen");
	});

	it("round-trips every dimension and an explicit range", () => {
		const qs =
			"cat=c1&person=user%3Au1&project=p1&paidby=me&kind=payment&from=2026-09-01&to=2026-09-30";
		const f = read(qs);
		expect(f).toMatchObject({
			cats: ["c1"],
			people: ["user:u1"],
			projects: ["p1"],
			paidBy: ["me"],
			kinds: ["payment"],
			range: { from: "2026-09-01", to: "2026-09-30" },
		});
		expect(read(writeFilter(f, TODAY))).toEqual(f);
	});

	it("keeps All time explicit and drops unknown kinds and bad dates", () => {
		const all = { ...read(""), range: { from: null, to: null } };
		expect(writeFilter(all, TODAY)).toBe("range=all");
		expect(read("range=all").range).toEqual({ from: null, to: null });
		expect(read("kind=payment,bogus").kinds).toEqual(["payment"]);
		expect(read("from=yesterday&to=2026-10-02").range).toEqual({
			from: null,
			to: "2026-10-02",
		});
	});

	it("sends only what is set to the server", () => {
		expect(queryOf(read("q=%20netflix%20&person=user%3Au1"))).toEqual({
			people: ["user:u1"],
			q: "netflix",
		});
		expect(queryOf(read(""))).toEqual({ from: "2026-10-01", to: "2026-10-31" });
	});

	it("toggles a value in a multi-select", () => {
		expect(toggled(["a"], "b")).toEqual(["a", "b"]);
		expect(toggled(["a", "b"], "a")).toEqual(["b"]);
	});
});
