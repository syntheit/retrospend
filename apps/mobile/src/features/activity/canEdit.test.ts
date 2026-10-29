import { canEditEntry } from "./canEdit";
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

describe("canEditEntry", () => {
	it("edits what the web edits from Activity: your expenses and splits", () => {
		expect(canEditEntry(item())).toBe(true);
		expect(canEditEntry(item({ source: "shared", mine: false }))).toBe(true);
	});

	it("leaves money in, transfers, payments and locked entries alone", () => {
		expect(canEditEntry(item({ kind: "income" }))).toBe(false);
		expect(canEditEntry(item({ kind: "refund" }))).toBe(false);
		expect(canEditEntry(item({ kind: "transfer" }))).toBe(false);
		expect(canEditEntry(item({ source: "payment", kind: "payment" }))).toBe(
			false,
		);
		expect(canEditEntry(item({ source: "shared", canEdit: false }))).toBe(
			false,
		);
		expect(canEditEntry(item({ locked: true }))).toBe(false);
	});
});
