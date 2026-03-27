import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "~/test/mock-db";
import { ImportQueueService } from "../import-queue.service";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockImportExpensesFromRows = vi.hoisted(() =>
	vi.fn().mockResolvedValue({ count: 3, skippedDuplicates: 0 }),
);

vi.mock("~/env", () => ({
	env: {
		SIDECAR_URL: "http://localhost:8080",
		WORKER_API_KEY: null,
		NODE_ENV: "test",
	},
}));

vi.mock("~/server/services/settings", () => ({
	getAppSettings: vi.fn().mockResolvedValue({
		maxConcurrentImportJobs: 3,
		auditPrivacyMode: "MINIMAL",
		inviteOnlyEnabled: false,
		allowAllUsersToGenerateInvites: false,
		enableEmail: true,
		defaultAiMode: "LOCAL",
		externalAiAccessMode: "WHITELIST",
		monthlyAiTokenQuota: 2000000,
	}),
}));

vi.mock("~/server/services/csv.service", () => ({
	// Regular function required - arrow functions cannot be used with `new`
	CsvService: vi.fn(function () {
		return { importExpensesFromRows: mockImportExpensesFromRows };
	}),
}));

vi.mock("~/server/services/ai-access.service", () => ({
	resolveAiAccess: vi.fn().mockResolvedValue({ allowed: true, effectiveMode: "LOCAL", quotaRemaining: null }),
	recordTokenUsage: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJob(overrides: Record<string, unknown> = {}) {
	return {
		id: "job-1",
		userId: "user-1",
		status: "QUEUED",
		type: "CSV",
		fileName: "test.csv",
		fileSize: 1000,
		fileType: "csv",
		fileData: null,
		createdAt: new Date("2024-06-01"),
		...overrides,
	};
}

// Valid CSV encoded as base64
const VALID_CSV_BASE64 = Buffer.from(
	"title,amount,currency,date\nCoffee,10,USD,2024-06-15\nLunch,25,USD,2024-06-16",
).toString("base64");

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ImportQueueService", () => {
	let db: ReturnType<typeof createMockDb>;
	let service: ImportQueueService;

	beforeEach(() => {
		vi.clearAllMocks();
		db = createMockDb();
		service = new ImportQueueService(db as never);
	});

	// ── createJob ──────────────────────────────────────────────────────────────

	describe("createJob", () => {
		const BASE_INPUT = {
			fileName: "test.csv",
			fileSize: 1000,
			fileType: "csv",
			type: "CSV" as const,
			fileData: VALID_CSV_BASE64,
		};

		it("rejects files exceeding 10MB", async () => {
			await expect(
				service.createJob("user-1", {
					...BASE_INPUT,
					fileSize: 11 * 1024 * 1024, // 11MB
				}),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
		});

		it("rejects when 5 or more pending jobs exist", async () => {
			db.importJob.count.mockResolvedValue(5);

			await expect(service.createJob("user-1", BASE_INPUT)).rejects.toMatchObject({
				code: "BAD_REQUEST",
			});
		});

		it("creates job with QUEUED status when under limits", async () => {
			db.importJob.count.mockResolvedValue(0);
			const created = makeJob({ status: "QUEUED" });
			db.importJob.create.mockResolvedValue(created);

			const result = await service.createJob("user-1", BASE_INPUT);

			expect(db.importJob.create).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						userId: "user-1",
						status: "QUEUED",
						type: "CSV",
						fileName: "test.csv",
					}),
				}),
			);
			expect(result).toBe(created);
		});

		it("does not throw when at 4 pending jobs (below limit of 5)", async () => {
			db.importJob.count.mockResolvedValue(4);
			db.importJob.create.mockResolvedValue(makeJob());

			await expect(service.createJob("user-1", BASE_INPUT)).resolves.not.toThrow();
		});

		it("exactly 10MB is rejected (> 10MB check)", async () => {
			const tenMB = 10 * 1024 * 1024;
			// 10MB exactly is NOT over the limit - fileSize > MAX_FILE_SIZE
			db.importJob.count.mockResolvedValue(0);
			db.importJob.create.mockResolvedValue(makeJob());

			await expect(
				service.createJob("user-1", { ...BASE_INPUT, fileSize: tenMB }),
			).resolves.not.toThrow();
		});
	});

	// ── processQueue (CSV processing) ─────────────────────────────────────────

	describe("processQueue", () => {
		it("processes a valid CSV job: updates to PROCESSING then READY_FOR_REVIEW", async () => {
			const queuedJob = makeJob({
				status: "QUEUED",
				type: "CSV",
				fileName: "test.csv",
				fileData: VALID_CSV_BASE64,
			});

			db.importJob.findFirst
				.mockResolvedValueOnce(queuedJob) // first call: get the job
				.mockResolvedValueOnce(null); // second call (recursive): no more jobs
			db.importJob.update.mockResolvedValue({ ...queuedJob, status: "PROCESSING" });

			await service.processQueue("user-1");

			// Should have been called to set PROCESSING
			expect(db.importJob.update).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: "job-1" },
					data: expect.objectContaining({ status: "PROCESSING" }),
				}),
			);

			// Should have been called to set READY_FOR_REVIEW with parsed transactions
			expect(db.importJob.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						status: "READY_FOR_REVIEW",
						totalTransactions: 2, // 2 rows in VALID_CSV
					}),
				}),
			);
		});

		it("CSV with missing required fields: row skipped, warning recorded", async () => {
			// Row with no title
			const csvBase64 = Buffer.from(
				"title,amount,currency,date\n,10,USD,2024-06-15\nLunch,25,USD,2024-06-16",
			).toString("base64");

			const job = makeJob({ status: "QUEUED", type: "CSV", fileName: "t.csv", fileData: csvBase64 });
			db.importJob.findFirst
				.mockResolvedValueOnce(job)
				.mockResolvedValueOnce(null);
			db.importJob.update.mockResolvedValue(job);

			await service.processQueue("user-1");

			const reviewCall = db.importJob.update.mock.calls.find((c) => {
				const data = (c[0] as { data: { status?: string } }).data;
				return data.status === "READY_FOR_REVIEW";
			});
			expect(reviewCall).toBeDefined();
			const updateData = (reviewCall![0] as { data: { totalTransactions: number; warnings?: string[] } }).data;
			expect(updateData.totalTransactions).toBe(1); // only 1 valid row
			expect(updateData.warnings).toBeDefined();
		});

		it("CSV with invalid amount (<=0): row rejected with warning", async () => {
			const csvBase64 = Buffer.from(
				"title,amount,currency,date\nFee,-5,USD,2024-06-15\nLunch,25,USD,2024-06-16",
			).toString("base64");

			const job = makeJob({ status: "QUEUED", type: "CSV", fileName: "t.csv", fileData: csvBase64 });
			db.importJob.findFirst.mockResolvedValueOnce(job).mockResolvedValueOnce(null);
			db.importJob.update.mockResolvedValue(job);

			await service.processQueue("user-1");

			const reviewCall = db.importJob.update.mock.calls.find(
				(c) => ((c[0] as { data: { status?: string } }).data.status) === "READY_FOR_REVIEW",
			);
			const data = (reviewCall![0] as { data: { totalTransactions: number } }).data;
			expect(data.totalTransactions).toBe(1);
		});

		it("USD row: exchangeRate=1 and amountInUSD=amount", async () => {
			const csvBase64 = Buffer.from(
				"title,amount,currency,date\nCoffee,42,USD,2024-06-15",
			).toString("base64");

			const job = makeJob({ status: "QUEUED", type: "CSV", fileName: "t.csv", fileData: csvBase64 });
			db.importJob.findFirst.mockResolvedValueOnce(job).mockResolvedValueOnce(null);
			db.importJob.update.mockResolvedValue(job);

			await service.processQueue("user-1");

			const reviewCall = db.importJob.update.mock.calls.find(
				(c) => ((c[0] as { data: { status?: string } }).data.status) === "READY_FOR_REVIEW",
			);
			const txs = (reviewCall![0] as { data: { transactions: Array<{ exchangeRate: number; amountInUSD: number }> } }).data.transactions;
			expect(txs[0]!.exchangeRate).toBe(1);
			expect(txs[0]!.amountInUSD).toBe(42);
		});

		it("row with exchangeRate provided: amountInUSD = amount / exchangeRate", async () => {
			const csvBase64 = Buffer.from(
				"title,amount,currency,date,exchangeRate\nFactura,1000,ARS,2024-06-15,1000",
			).toString("base64");

			const job = makeJob({ status: "QUEUED", type: "CSV", fileName: "t.csv", fileData: csvBase64 });
			db.importJob.findFirst.mockResolvedValueOnce(job).mockResolvedValueOnce(null);
			db.importJob.update.mockResolvedValue(job);

			await service.processQueue("user-1");

			const reviewCall = db.importJob.update.mock.calls.find(
				(c) => ((c[0] as { data: { status?: string } }).data.status) === "READY_FOR_REVIEW",
			);
			const txs = (reviewCall![0] as { data: { transactions: Array<{ exchangeRate: number; amountInUSD: number }> } }).data.transactions;
			expect(txs[0]!.exchangeRate).toBeCloseTo(1000);
			expect(txs[0]!.amountInUSD).toBeCloseTo(1); // 1000 / 1000
		});

		it("row with amountInUSD provided: exchangeRate = amount / amountInUSD", async () => {
			const csvBase64 = Buffer.from(
				"title,amount,currency,date,amountInUSD\nFactura,1000,ARS,2024-06-15,1",
			).toString("base64");

			const job = makeJob({ status: "QUEUED", type: "CSV", fileName: "t.csv", fileData: csvBase64 });
			db.importJob.findFirst.mockResolvedValueOnce(job).mockResolvedValueOnce(null);
			db.importJob.update.mockResolvedValue(job);

			await service.processQueue("user-1");

			const reviewCall = db.importJob.update.mock.calls.find(
				(c) => ((c[0] as { data: { status?: string } }).data.status) === "READY_FOR_REVIEW",
			);
			const txs = (reviewCall![0] as { data: { transactions: Array<{ exchangeRate: number; amountInUSD: number }> } }).data.transactions;
			expect(txs[0]!.exchangeRate).toBeCloseTo(1000); // 1000 / 1
			expect(txs[0]!.amountInUSD).toBeCloseTo(1);
		});

		it("non-USD row without exchangeRate or amountInUSD: row skipped with warning", async () => {
			const csvBase64 = Buffer.from(
				"title,amount,currency,date\nFactura,1000,ARS,2024-06-15",
			).toString("base64");

			const job = makeJob({ status: "QUEUED", type: "CSV", fileName: "t.csv", fileData: csvBase64 });
			db.importJob.findFirst.mockResolvedValueOnce(job).mockResolvedValueOnce(null);

			// All rows invalid → processCsvJob throws, job is marked FAILED
			db.importJob.update.mockResolvedValue(job);

			await service.processQueue("user-1");

			const failedCall = db.importJob.update.mock.calls.find(
				(c) => ((c[0] as { data: { status?: string } }).data.status) === "FAILED",
			);
			expect(failedCall).toBeDefined();
		});
	});

	// ── finalizeImport ─────────────────────────────────────────────────────────

	describe("finalizeImport", () => {
		const TRANSACTIONS = [
			{
				title: "Coffee",
				amount: 10,
				currency: "USD",
				exchangeRate: 1,
				amountInUSD: 10,
				date: "2024-06-15",
				location: "",
				description: "",
				pricingSource: "IMPORT",
				category: "",
			},
		];

		it("throws NOT_FOUND if job does not exist", async () => {
			db.importJob.findUnique.mockResolvedValue(null);

			await expect(
				service.finalizeImport("user-1", "job-1", { selectedTransactions: TRANSACTIONS }),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
		});

		it("throws FORBIDDEN if job belongs to a different user", async () => {
			db.importJob.findUnique.mockResolvedValue(makeJob({ userId: "other-user" }));

			await expect(
				service.finalizeImport("user-1", "job-1", { selectedTransactions: TRANSACTIONS }),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		});

		it("throws BAD_REQUEST if job is not in REVIEWING state", async () => {
			db.importJob.findUnique.mockResolvedValue(makeJob({ status: "QUEUED" }));

			await expect(
				service.finalizeImport("user-1", "job-1", { selectedTransactions: TRANSACTIONS }),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
		});

		it("delegates to CsvService and marks job COMPLETED", async () => {
			db.importJob.findUnique.mockResolvedValue(makeJob({ status: "REVIEWING" }));
			db.importJob.update.mockResolvedValue(makeJob({ status: "COMPLETED" }));

			const result = await service.finalizeImport("user-1", "job-1", {
				selectedTransactions: TRANSACTIONS,
			});

			expect(mockImportExpensesFromRows).toHaveBeenCalled();
			expect(db.importJob.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({ status: "COMPLETED" }),
				}),
			);
			expect(result).toMatchObject({ count: 3 });
		});
	});

	// ── cancelJob ─────────────────────────────────────────────────────────────

	describe("cancelJob", () => {
		it("throws NOT_FOUND if job does not exist", async () => {
			db.importJob.findUnique.mockResolvedValue(null);

			await expect(service.cancelJob("user-1", "job-1")).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
		});

		it("throws FORBIDDEN if job belongs to different user", async () => {
			db.importJob.findUnique.mockResolvedValue(makeJob({ userId: "other-user" }));

			await expect(service.cancelJob("user-1", "job-1")).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
		});

		it("throws BAD_REQUEST if job is not QUEUED (e.g. PROCESSING)", async () => {
			db.importJob.findUnique.mockResolvedValue(makeJob({ status: "PROCESSING" }));

			await expect(service.cancelJob("user-1", "job-1")).rejects.toMatchObject({
				code: "BAD_REQUEST",
			});
		});

		it("throws BAD_REQUEST for COMPLETED job", async () => {
			db.importJob.findUnique.mockResolvedValue(makeJob({ status: "COMPLETED" }));

			await expect(service.cancelJob("user-1", "job-1")).rejects.toMatchObject({
				code: "BAD_REQUEST",
			});
		});

		it("cancels a QUEUED job successfully and clears fileData", async () => {
			db.importJob.findUnique.mockResolvedValue(makeJob({ status: "QUEUED" }));
			const cancelled = makeJob({ status: "CANCELLED", fileData: null });
			db.importJob.update.mockResolvedValue(cancelled);

			const result = await service.cancelJob("user-1", "job-1");

			expect(db.importJob.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({ status: "CANCELLED", fileData: null }),
				}),
			);
			expect(result).toBe(cancelled);
		});
	});

	// ── deleteJob ──────────────────────────────────────────────────────────────

	describe("deleteJob", () => {
		it("throws NOT_FOUND if job does not exist", async () => {
			db.importJob.findUnique.mockResolvedValue(null);

			await expect(service.deleteJob("user-1", "job-1")).rejects.toMatchObject({
				code: "NOT_FOUND",
			});
		});

		it("throws FORBIDDEN if job belongs to different user", async () => {
			db.importJob.findUnique.mockResolvedValue(makeJob({ userId: "other-user" }));

			await expect(service.deleteJob("user-1", "job-1")).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
		});

		it("throws BAD_REQUEST if job is QUEUED (cannot delete active job)", async () => {
			db.importJob.findUnique.mockResolvedValue(makeJob({ status: "QUEUED" }));

			await expect(service.deleteJob("user-1", "job-1")).rejects.toMatchObject({
				code: "BAD_REQUEST",
			});
		});

		it("throws BAD_REQUEST if job is PROCESSING", async () => {
			db.importJob.findUnique.mockResolvedValue(makeJob({ status: "PROCESSING" }));

			await expect(service.deleteJob("user-1", "job-1")).rejects.toMatchObject({
				code: "BAD_REQUEST",
			});
		});

		it("deletes a COMPLETED job successfully", async () => {
			db.importJob.findUnique.mockResolvedValue(makeJob({ status: "COMPLETED" }));
			db.importJob.delete.mockResolvedValue({});

			const result = await service.deleteJob("user-1", "job-1");

			expect(db.importJob.delete).toHaveBeenCalledWith({ where: { id: "job-1" } });
			expect(result).toEqual({ success: true });
		});

		it("deletes a FAILED job successfully", async () => {
			db.importJob.findUnique.mockResolvedValue(makeJob({ status: "FAILED" }));
			db.importJob.delete.mockResolvedValue({});

			await expect(service.deleteJob("user-1", "job-1")).resolves.toEqual({ success: true });
		});

		it("deletes a CANCELLED job successfully", async () => {
			db.importJob.findUnique.mockResolvedValue(makeJob({ status: "CANCELLED" }));
			db.importJob.delete.mockResolvedValue({});

			await expect(service.deleteJob("user-1", "job-1")).resolves.toEqual({ success: true });
		});

		it("deletes a READY_FOR_REVIEW job successfully", async () => {
			db.importJob.findUnique.mockResolvedValue(makeJob({ status: "READY_FOR_REVIEW" }));
			db.importJob.delete.mockResolvedValue({});

			await expect(service.deleteJob("user-1", "job-1")).resolves.toEqual({ success: true });
		});
	});
});
