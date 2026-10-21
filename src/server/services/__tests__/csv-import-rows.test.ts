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
});

vi.mock("~/server/services/amortization.service", () => ({
	AmortizationService: vi.fn(function () {
		return { syncAmortization: vi.fn() };
	}),
}));
