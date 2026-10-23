import { describe, expect, it } from "vitest";
import {
	IMPORT_KINDS,
	kindColumns,
	kindOfColumns,
	proposeKind,
	storedRows,
	unreadableCount,
} from "./rows";

const row = (extra: Record<string, unknown> = {}) => ({
	title: "Coto",
	amount: 38200,
	currency: "ARS",
	date: "2026-10-19",
	location: "",
	description: "",
	pricingSource: "IMPORT",
	category: "",
	...extra,
});

describe("proposeKind", () => {
	it("is Expense unless the file names a kind", () => {
		expect(proposeKind(row())).toBe("expense");
		expect(proposeKind(row({ kind: "Income" }))).toBe("income");
		expect(proposeKind(row({ kind: " refund " }))).toBe("refund");
		expect(proposeKind(row({ kind: "Not spending" }))).toBe("notSpending");
		expect(proposeKind(row({ kind: "transfer" }))).toBe("notSpending");
		expect(proposeKind(row({ kind: "gift" }))).toBe("expense");
	});
});

describe("kindColumns", () => {
	it("round-trips every kind through the stored columns", () => {
		for (const kind of IMPORT_KINDS)
			expect(kindOfColumns(kindColumns(kind))).toBe(kind);
	});

	it("sets inType exactly for money in that is standard", () => {
		expect(kindColumns("income")).toEqual({
			direction: "IN",
			entryKind: "STANDARD",
			inType: "INCOME",
		});
		expect(kindColumns("notSpending").inType).toBeNull();
	});
});

describe("unreadableCount", () => {
	it("counts each skipped row once and ignores other warnings", () => {
		expect(
			unreadableCount([
				"Row 3: Missing date, skipping",
				"Row 3: Invalid amount, skipping",
				'Row 7: Invalid currency "", skipping',
				"Excel file contains 2 sheets.",
				42,
			]),
		).toBe(2);
		expect(unreadableCount(null)).toBe(0);
	});
});

describe("storedRows", () => {
	it("keeps rows and drops anything else", () => {
		expect(storedRows([row(), { title: 1 }, null])).toHaveLength(1);
		expect(storedRows({})).toEqual([]);
	});
});
