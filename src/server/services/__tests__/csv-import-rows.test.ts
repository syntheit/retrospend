/**
 * CSV / statement import (batch 4): duplicates match by calendar day in the
 * user's zone, and excludeFromAnalytics comes from the row or the category.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useExpenseTable } from "~/test/expense-table";
import { createMockDb } from "~/test/mock-db";
import { useRateTable } from "~/test/rate-table";
import { CsvService } from "../csv.service";

const BA = "America/Argentina/Buenos_Aires";
// Midnight Oct 5 in Buenos Aires, as the browser sends a picked date
const OCT5_LOCAL = new Date("2026-10-05T03:00:00Z");

describe("CsvService.importExpensesFromRows", () => {
	let db: ReturnType<typeof createMockDb>;
	let service: CsvService;

	beforeEach(() => {
		db = createMockDb();
		useRateTable(db);
		service = new CsvService(db as never);
		db.category.findMany.mockResolvedValue([
			{ id: "cat-transfer", excludeByDefault: true },
			{ id: "cat-food", excludeByDefault: false },
		]);
	});

	function created() {
		return db.expense.createMany.mock.calls.flatMap(
			(c) => (c[0] as { data: Array<Record<string, unknown>> }).data,
		);
	}

	it("skips a row that matches an expense saved later the same local day", async () => {
		useExpenseTable(db, [
			// Saved with the "Today" chip at 22:30 local, already Oct 6 in UTC
			{ date: new Date("2026-10-06T01:30:00Z"), title: "Coffee", amount: 3500, currency: "ARS", amountInUSD: 2.24 },
		]);

		const result = await service.importExpensesFromRows(
			"user-1",
			[
				{ title: "Coffee", amount: 3500, currency: "ARS", date: OCT5_LOCAL, exchangeRate: 1560 },
				{ title: "Lunch", amount: 9000, currency: "ARS", date: OCT5_LOCAL, exchangeRate: 1560 },
			],
			{ timeZone: BA },
		);

		expect(result.skippedDuplicates).toBe(1);
		expect(created().map((e) => e.title)).toEqual(["Lunch"]);
		// The lookup covers the whole local day
		const where = db.expense.findMany.mock.calls[0]![0].where;
		expect(where.date).toEqual({
			gte: new Date("2026-10-05T03:00:00Z"),
			lt: new Date("2026-10-06T03:00:00Z"),
		});
	});

	it("an expense on the next local day is not a duplicate", async () => {
		useExpenseTable(db, [
			{ date: new Date("2026-10-06T04:00:00Z"), title: "Coffee", amount: 3500, currency: "ARS", amountInUSD: 2.24 },
		]);

		const result = await service.importExpensesFromRows(
			"user-1",
			[{ title: "Coffee", amount: 3500, currency: "ARS", date: OCT5_LOCAL, exchangeRate: 1560 }],
			{ timeZone: BA },
		);

		expect(result.skippedDuplicates).toBe(0);
	});

	it("excludeFromAnalytics: row value, else category default, else counted", async () => {
		useExpenseTable(db, []);

		await service.importExpensesFromRows(
			"user-1",
			[
				{ title: "Transfer", amount: 100, currency: "USD", date: OCT5_LOCAL, categoryId: "cat-transfer" },
				{ title: "Food", amount: 10, currency: "USD", date: OCT5_LOCAL, categoryId: "cat-food" },
				{ title: "Flagged", amount: 20, currency: "USD", date: OCT5_LOCAL, categoryId: "cat-food", excludeFromAnalytics: true },
				{ title: "Kept", amount: 30, currency: "USD", date: OCT5_LOCAL, categoryId: "cat-transfer", excludeFromAnalytics: false },
				{ title: "None", amount: 40, currency: "USD", date: OCT5_LOCAL },
			],
			{ timeZone: BA },
		);

		expect(
			Object.fromEntries(created().map((e) => [e.title, e.excludeFromAnalytics])),
		).toEqual({ Transfer: true, Food: false, Flagged: true, Kept: false, None: false });
	});
	it("stores text without control characters and matches duplicates on what is stored", async () => {
		useExpenseTable(db, [
			{ date: OCT5_LOCAL, title: "Coffee", amount: 3500, currency: "ARS", amountInUSD: 2.24 },
		]);

		const result = await service.importExpensesFromRows(
			"user-1",
			[
				{ title: "Cof\u000bfee", amount: 3500, currency: "ARS", date: OCT5_LOCAL, exchangeRate: 1560 },
				{
					title: "  Lun\u0001ch ",
					amount: 9000,
					currency: "ARS",
					date: OCT5_LOCAL,
					exchangeRate: 1560,
					location: "BA\u0000",
					description: "one\r\ntwo\u0007\tthree",
				},
				{ title: "Dinner", amount: 100, currency: "ARS", date: OCT5_LOCAL, exchangeRate: 1560, location: "", description: null },
			],
			{ timeZone: BA },
		);

		expect(result.skippedDuplicates).toBe(1);
		const rows = created();
		expect(rows.map((e) => e.title)).toEqual(["  Lunch ", "Dinner"]);
		expect(rows[0]).toMatchObject({ location: "BA", description: "one\r\ntwo\tthree" });
		expect(rows[1]).toMatchObject({ location: "", description: undefined });
	});
	it("rejects a row whose text starts with U+0001 and imports the rest", async () => {
		useExpenseTable(db, []);
		const base = { amount: 100, currency: "ARS", date: OCT5_LOCAL, exchangeRate: 1560 };

		const result = await service.importExpensesFromRows(
			"user-1",
			[
				{ ...base, title: "Fine" },
				{ ...base, title: "\u0001k1:AAAA" },
				{ ...base, title: "Also fine", location: "\u0001k1:BBBB" },
				{ ...base, title: "Last", description: "\u0001k1:CCCC" },
				{ ...base, title: "Kept", location: "BA" },
			],
			{ timeZone: BA },
		);

		expect(result.count).toBe(2);
		expect(created().map((e) => e.title)).toEqual(["Fine", "Kept"]);
		expect(result.rejected.map((r) => r.row)).toEqual([1, 2, 3]);
		expect(result.rejected[0]?.reason).toContain("U+0001");
		expect(JSON.stringify(result)).not.toContain("k1:");
	});

	describe("a control character inside a title", () => {
		const row = (title: string) => ({
			title,
			amount: 3500,
			currency: "ARS",
			date: OCT5_LOCAL,
			exchangeRate: 1560,
		});
		const existing = (title: string) =>
			useExpenseTable(db, [
				{ date: OCT5_LOCAL, title, amount: 3500, currency: "ARS", amountInUSD: 2.24 },
			]);

		it("importing the same file again skips the row", async () => {
			useExpenseTable(db, []);
			const file = [row("COFFEE\u000bSHOP 123")];
			const first = await service.importExpensesFromRows("user-1", file, { timeZone: BA });
			expect(first.skippedDuplicates).toBe(0);
			const stored = created().map((e) => e.title as string);
			expect(stored).toEqual(["COFFEESHOP 123"]);

			existing(stored[0] ?? "");
			const again = await service.importExpensesFromRows("user-1", file, { timeZone: BA });
			expect(again.skippedDuplicates).toBe(1);
			expect(created()).toHaveLength(1);
		});

		it("a row stored before the change, with the control in it, is still a duplicate", async () => {
			existing("COFFEE\u000bSHOP 123");
			const result = await service.importExpensesFromRows(
				"user-1",
				[row("COFFEE\u000bSHOP 123")],
				{ timeZone: BA },
			);
			expect(result.skippedDuplicates).toBe(1);
			expect(created()).toEqual([]);
		});

		it("a different title is not a duplicate", async () => {
			existing("COFFEE SHOP 124");
			const result = await service.importExpensesFromRows(
				"user-1",
				[row("COFFEE\u000bSHOP 123")],
				{ timeZone: BA },
			);
			expect(result.skippedDuplicates).toBe(0);
		});

		it("the same row twice in one file is imported once", async () => {
			useExpenseTable(db, []);
			const result = await service.importExpensesFromRows(
				"user-1",
				[row("COFFEE\u000bSHOP 123"), row("COFFEE\u000bSHOP 123")],
				{ timeZone: BA },
			);
			expect(result.skippedDuplicates).toBe(1);
			expect(created()).toHaveLength(1);
		});
	});
});

vi.mock("~/server/services/amortization.service", () => ({
	AmortizationService: vi.fn(function () {
		return { syncAmortization: vi.fn() };
	}),
}));
