import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MissingRateError } from "@retrospend/domain/money";
import { makeCategory, makeExpense } from "~/test/factories";
import { createMockDb } from "~/test/mock-db";
import { RATE_DATE, useRateTable } from "~/test/rate-table";
import { ExpenseService } from "../expense.service";

// ── Hoisted mocks (referenced inside vi.mock factories) ───────────────────────

const mockSyncAmortization = vi.hoisted(() =>
	vi.fn().mockResolvedValue(undefined),
);

vi.mock("~/server/services/amortization.service", () => ({
	// Regular function required - arrow functions cannot be used with `new`
	AmortizationService: vi.fn(function () {
		return { syncAmortization: mockSyncAmortization };
	}),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_INPUT = {
	id: "exp-1",
	title: "Coffee",
	amount: 10,
	currency: "USD",
	date: new Date("2024-06-15"),
} as const;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ExpenseService", () => {
	let db: ReturnType<typeof createMockDb>;
	let service: ExpenseService;

	beforeEach(() => {
		vi.clearAllMocks();
		db = createMockDb();
		service = new ExpenseService(db as never);

		// Sensible defaults
		useRateTable(db);
		db.user.findUnique.mockResolvedValue({
			homeCurrency: "USD",
			defaultRateTypes: {},
		});
		db.expense.create.mockResolvedValue(makeExpense());
	});

	// ── createExpense ──────────────────────────────────────────────────────────

	describe("createExpense", () => {
		it("USD: sets exchangeRate=1 and amountInUSD=amount", async () => {
			db.expense.create.mockResolvedValue(
				makeExpense({
					id: "exp-1",
					amount: 10,
					currency: "USD",
					exchangeRate: 1,
					amountInUSD: 10,
				}),
			);

			await service.createExpense("user-1", BASE_INPUT);

			expect(db.expense.create).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						exchangeRate: 1,
						amountInUSD: 10,
						currency: "USD",
					}),
				}),
			);
		});

		it("USD: does not look up a rate", async () => {
			await service.createExpense("user-1", BASE_INPUT);

			expect(db.exchangeRate.findMany).not.toHaveBeenCalled();
		});

		it("custom fiat rate: kept, amountInUSD = amount / rate", async () => {
			// ARS: 1000 ARS / 1000 = 1 USD
			await service.createExpense("user-1", {
				...BASE_INPUT,
				amount: 1000,
				currency: "ARS",
				exchangeRate: 1000,
				pricingSource: "custom",
			});

			expect(db.expense.create).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						exchangeRate: 1000,
						amountInUSD: 1,
						currency: "ARS",
					}),
				}),
			);
		});

		it("fiat without rate: uses the best table rate (blue for ARS)", async () => {
			await service.createExpense("user-1", {
				...BASE_INPUT,
				amount: 1560,
				currency: "ARS",
			});

			expect(db.expense.create).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						exchangeRate: 1560,
						amountInUSD: 1,
					}),
				}),
			);
		});

		it("fiat without rate AND no rate available: throws MissingRateError (tRPC answers BAD_REQUEST)", async () => {
			useRateTable(db, []);

			await expect(
				service.createExpense("user-1", {
					...BASE_INPUT,
					amount: 1000,
					currency: "ARS",
				}),
			).rejects.toEqual(new MissingRateError("ARS"));
			expect(db.expense.create).not.toHaveBeenCalled();
		});

		it("crypto (BTC): amountInUSD = amount * rate (multiplication)", async () => {
			useRateTable(db, [
				{ currency: "BTC", type: "crypto", rate: 50000, date: RATE_DATE },
			]);

			await service.createExpense("user-1", {
				...BASE_INPUT,
				amount: 0.1,
				currency: "BTC",
			});

			expect(db.expense.create).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						amountInUSD: 5000, // 0.1 * 50000
					}),
				}),
			);
		});

		it("crypto: exchange rate is NOT divided (confirmed by checking exact amountInUSD)", async () => {
			// ETH: 2 ETH @ 3000 USD/ETH = 6000 USD (multiply), NOT 2/3000
			useRateTable(db, [
				{ currency: "ETH", type: "crypto", rate: 3000, date: RATE_DATE },
			]);

			await service.createExpense("user-1", {
				...BASE_INPUT,
				amount: 2,
				currency: "ETH",
			});

			const call = db.expense.create.mock.calls[0]![0] as {
				data: { amountInUSD: number };
			};
			expect(call.data.amountInUSD).toBeCloseTo(6000);
		});

		it("amortizeOver > 1: calls AmortizationService.syncAmortization", async () => {
			const parentExpense = makeExpense({ id: "exp-3" });
			db.expense.create.mockResolvedValue(parentExpense);

			await service.createExpense("user-1", {
				...BASE_INPUT,
				id: "exp-3",
				amortizeOver: 3,
			});

			expect(mockSyncAmortization).toHaveBeenCalledWith(parentExpense, 3);
		});

		it("amortizeOver = 1: does NOT call AmortizationService.syncAmortization", async () => {
			await service.createExpense("user-1", { ...BASE_INPUT, amortizeOver: 1 });

			expect(mockSyncAmortization).not.toHaveBeenCalled();
		});

		it("amortizeOver undefined: does NOT call AmortizationService.syncAmortization", async () => {
			await service.createExpense("user-1", BASE_INPUT);

			expect(mockSyncAmortization).not.toHaveBeenCalled();
		});

		it("invalid categoryId (not owned by user): throws FORBIDDEN", async () => {
			db.category.findFirst.mockResolvedValue(null);

			await expect(
				service.createExpense("user-1", {
					...BASE_INPUT,
					categoryId: "cat-999",
				}),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		});

		it("valid categoryId owned by user: proceeds and creates expense", async () => {
			db.category.findFirst.mockResolvedValue(
				makeCategory({ id: "cat-1", userId: "user-1" }),
			);

			await service.createExpense("user-1", {
				...BASE_INPUT,
				categoryId: "cat-1",
			});

			expect(db.expense.create).toHaveBeenCalled();
		});

		it("sets status=FINALIZED, userId, and pricingSource=MANUAL in create data", async () => {
			await service.createExpense("user-1", BASE_INPUT);

			expect(db.expense.create).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						status: "FINALIZED",
						userId: "user-1",
						pricingSource: "MANUAL",
					}),
				}),
			);
		});

		it("explicit pricingSource in input overrides default MANUAL", async () => {
			await service.createExpense("user-1", {
				...BASE_INPUT,
				pricingSource: "IMPORT",
			});

			expect(db.expense.create).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({ pricingSource: "IMPORT" }),
				}),
			);
		});

		it("calls $executeRaw with set_config inside transaction (RLS)", async () => {
			await service.createExpense("user-1", BASE_INPUT);

			expect(db.$executeRaw).toHaveBeenCalled();
		});
	});

	// ── updateExpense ──────────────────────────────────────────────────────────

	describe("updateExpense", () => {
		const UPDATE_INPUT = {
			id: "exp-1",
			title: "Updated Coffee",
			amount: 15,
			currency: "USD",
			date: new Date("2024-06-15"),
		};

		it("updates expense when it exists", async () => {
			const existing = makeExpense({ id: "exp-1", userId: "user-1" });
			db.expense.findFirst.mockResolvedValue(existing);
			db.expense.update.mockResolvedValue(existing);

			await service.updateExpense("user-1", UPDATE_INPUT);

			expect(db.expense.update).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: "exp-1", userId: "user-1" },
				}),
			);
		});

		it("always calls AmortizationService.syncAmortization on update", async () => {
			const existing = makeExpense({ id: "exp-1", userId: "user-1" });
			db.expense.findFirst.mockResolvedValue(existing);
			db.expense.update.mockResolvedValue(existing);

			await service.updateExpense("user-1", UPDATE_INPUT);

			expect(mockSyncAmortization).toHaveBeenCalled();
		});

		it("non-existent expense: throws NOT_FOUND", async () => {
			db.expense.findFirst.mockResolvedValue(null);

			await expect(
				service.updateExpense("user-1", UPDATE_INPUT),
			).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
		});

		it("non-existent expense: does not call update", async () => {
			db.expense.findFirst.mockResolvedValue(null);

			await expect(
				service.updateExpense("user-1", UPDATE_INPUT),
			).rejects.toThrow(TRPCError);

			expect(db.expense.update).not.toHaveBeenCalled();
		});

		it("changed categoryId not owned by user: throws FORBIDDEN and does not update", async () => {
			const existing = makeExpense({
				id: "exp-1",
				userId: "user-1",
				categoryId: "cat-1",
			});
			db.expense.findFirst.mockResolvedValue(existing);
			db.category.findFirst.mockResolvedValue(null);

			await expect(
				service.updateExpense("user-1", {
					...UPDATE_INPUT,
					categoryId: "cat-other",
				}),
			).rejects.toMatchObject({ code: "FORBIDDEN" });

			expect(db.category.findFirst).toHaveBeenCalledWith(
				// Income categories never hold an expense.
				expect.objectContaining({
					where: { id: "cat-other", userId: "user-1", kind: "EXPENSE" },
				}),
			);
			expect(db.expense.update).not.toHaveBeenCalled();
		});

		it("changed categoryId owned by user: proceeds", async () => {
			const existing = makeExpense({
				id: "exp-1",
				userId: "user-1",
				categoryId: "cat-1",
			});
			db.expense.findFirst.mockResolvedValue(existing);
			db.expense.update.mockResolvedValue(existing);
			db.category.findFirst.mockResolvedValue(
				makeCategory({ id: "cat-2", userId: "user-1" }),
			);

			await service.updateExpense("user-1", {
				...UPDATE_INPUT,
				categoryId: "cat-2",
			});

			expect(db.expense.update).toHaveBeenCalled();
		});

		it("unchanged categoryId: skips the ownership lookup", async () => {
			const existing = makeExpense({
				id: "exp-1",
				userId: "user-1",
				categoryId: "cat-1",
			});
			db.expense.findFirst.mockResolvedValue(existing);
			db.expense.update.mockResolvedValue(existing);

			await service.updateExpense("user-1", {
				...UPDATE_INPUT,
				categoryId: "cat-1",
			});

			expect(db.category.findFirst).not.toHaveBeenCalled();
			expect(db.expense.update).toHaveBeenCalled();
		});
	});

	// ── deleteExpense ──────────────────────────────────────────────────────────

	describe("deleteExpense", () => {
		it("normal (non-amortized) expense: deletes it, returns success", async () => {
			db.expense.findFirst.mockResolvedValue({
				id: "exp-1",
				isAmortizedParent: false,
			});
			db.expense.delete.mockResolvedValue({});

			const result = await service.deleteExpense("user-1", "exp-1");

			expect(db.expense.delete).toHaveBeenCalledWith({
				where: { id: "exp-1" },
			});
			expect(result).toEqual({ success: true });
		});

		it("normal expense: does NOT delete children", async () => {
			db.expense.findFirst.mockResolvedValue({
				id: "exp-1",
				isAmortizedParent: false,
			});
			db.expense.delete.mockResolvedValue({});

			await service.deleteExpense("user-1", "exp-1");

			expect(db.expense.deleteMany).not.toHaveBeenCalled();
		});

		it("amortized parent: deletes children first, then parent", async () => {
			db.expense.findFirst.mockResolvedValue({
				id: "exp-1",
				isAmortizedParent: true,
			});
			db.expense.delete.mockResolvedValue({});

			await service.deleteExpense("user-1", "exp-1");

			expect(db.expense.deleteMany).toHaveBeenCalledWith({
				where: { parentId: "exp-1", userId: "user-1" },
			});
			expect(db.expense.delete).toHaveBeenCalledWith({
				where: { id: "exp-1" },
			});
		});

		it("non-existent expense: throws NOT_FOUND", async () => {
			db.expense.findFirst.mockResolvedValue(null);

			await expect(
				service.deleteExpense("user-1", "exp-999"),
			).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
		});

		it("calls $executeRaw (set_config) inside transaction", async () => {
			db.expense.findFirst.mockResolvedValue({
				id: "exp-1",
				isAmortizedParent: false,
			});
			db.expense.delete.mockResolvedValue({});

			await service.deleteExpense("user-1", "exp-1");

			expect(db.$executeRaw).toHaveBeenCalled();
		});
	});

	// ── runInTransaction (via public methods) ──────────────────────────────────

	describe("runInTransaction", () => {
		it("callback return value is passed through to caller", async () => {
			const returned = makeExpense({ id: "exp-123" });
			db.expense.create.mockResolvedValue(returned);

			const result = await service.createExpense("user-1", {
				...BASE_INPUT,
				id: "exp-123",
			});

			expect(result).toMatchObject({ id: "exp-123" });
		});
	});
});
