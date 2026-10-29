import { canSelect, entityIdsOf } from "./bulk";
import type { ActivityItem } from "./source";

const item = (over: Partial<ActivityItem> = {}): ActivityItem => ({
	id: "a",
	source: "personal",
	entityId: "ea",
	kind: "expense",
	title: "Coffee",
	category: null,
	amount: { minor: 1000, currency: "ARS" },
	sortKey: 1000,
	project: null,
	date: "2026-10-21",
	mine: true,
	locked: false,
	canEdit: true,
	...over,
});

describe("canSelect", () => {
	it("picks only your own editable personal expenses", () => {
		expect(canSelect(item())).toBe(true);
		expect(canSelect(item({ source: "shared" }))).toBe(false);
		expect(canSelect(item({ source: "payment", kind: "payment" }))).toBe(false);
		expect(canSelect(item({ kind: "income" }))).toBe(false);
		expect(canSelect(item({ kind: "transfer" }))).toBe(false);
		expect(canSelect(item({ mine: false }))).toBe(false);
		expect(canSelect(item({ canEdit: false }))).toBe(false);
		expect(canSelect(item({ locked: true }))).toBe(false);
	});
});

describe("entityIdsOf", () => {
	it("maps the picked rows to their entry ids, in list order", () => {
		const rows = [
			item({ id: "a", entityId: "ea" }),
			item({ id: "b", entityId: "eb" }),
			item({ id: "c", entityId: "ec" }),
		];
		expect(entityIdsOf(rows, new Set(["c", "a"]))).toEqual(["ea", "ec"]);
	});
});
