import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "~/test/mock-db";
import {
	AI_IMPORT_OFF_MESSAGE,
	importProviderFor,
	isAiImportEnabled,
	readSidecarModels,
} from "../ai-access.service";
import { ImportQueueService } from "../import-queue.service";

vi.mock("~/env", () => ({
	env: {
		SIDECAR_URL: "http://sidecar:8080",
		WORKER_API_KEY: "worker-key",
		OPENROUTER_API_KEY: "or-key",
		NODE_ENV: "test",
	},
}));

vi.mock("~/server/services/settings", () => ({
	getAppSettings: vi.fn().mockResolvedValue({
		maxConcurrentImportJobs: 3,
		externalAiAccessMode: "BLACKLIST",
		monthlyLocalAiTokenQuota: 1_000_000,
		monthlyExternalAiTokenQuota: 1_000_000,
	}),
}));

const BANK_CSV = Buffer.from(
	"Fecha,Detalle,Importe\n2024-06-15,Cafe,-10",
).toString("base64");
const RETROSPEND_CSV = Buffer.from(
	"title,amount,currency,date\nCoffee,10,USD,2024-06-15",
).toString("base64");

const importer = () =>
	new Response(
		`${JSON.stringify({
			type: "result",
			data: [{ title: "Cafe", amount: 10, currency: "USD", date: "2024-06-15" }],
			metadata: { totalTokensUsed: 5 },
		})}\n`,
	);

function queuedJob(fileType: string, fileData: string, type = "BANK_STATEMENT") {
	return {
		id: "job-1",
		userId: "user-1",
		status: "QUEUED",
		type,
		fileName: `statement.${fileType}`,
		fileSize: 100,
		fileType,
		fileData,
		createdAt: new Date("2024-06-01"),
	};
}

describe("AI import opt-in", () => {
	let db: ReturnType<typeof createMockDb>;
	let service: ImportQueueService;
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		db = createMockDb();
		service = new ImportQueueService(db as never);
		fetchMock = vi.fn(async () => importer());
		vi.stubGlobal("fetch", fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	function optedIn(on: boolean) {
		db.user.findUnique.mockResolvedValue({
			aiMode: "LOCAL",
			aiImportEnabled: on,
			externalAiAllowed: null,
			role: "USER",
		});
		db.aiUsage.findUnique.mockResolvedValue(null);
	}

	describe("reading the setting", () => {
		it("is off for an account that never turned it on", async () => {
			optedIn(false);
			expect(await isAiImportEnabled(db as never, "user-1")).toBe(false);
		});

		it("is on once the account turned it on", async () => {
			optedIn(true);
			expect(await isAiImportEnabled(db as never, "user-1")).toBe(true);
		});

		it("is off for a missing user", async () => {
			db.user.findUnique.mockResolvedValue(null);
			expect(await isAiImportEnabled(db as never, "ghost")).toBe(false);
		});
	});

	describe("a queued statement with the setting off", () => {
		it("never sends a PDF to a provider and fails the job", async () => {
			optedIn(false);
			db.importJob.findFirst
				.mockResolvedValueOnce(queuedJob("pdf", "JVBERg=="))
				.mockResolvedValueOnce(null);
			db.importJob.update.mockResolvedValue({});

			await service.processQueue("user-1");

			expect(fetchMock).not.toHaveBeenCalled();
			const failed = db.importJob.update.mock.calls.find(
				(c) => (c[0] as { data: { status?: string } }).data.status === "FAILED",
			);
			expect(failed).toBeDefined();
			expect(JSON.stringify(failed)).toContain(AI_IMPORT_OFF_MESSAGE);
		});

		it("reads a spreadsheet with the plain CSV reader instead", async () => {
			optedIn(false);
			db.importJob.findFirst
				.mockResolvedValueOnce(queuedJob("csv", RETROSPEND_CSV))
				.mockResolvedValueOnce(null);
			db.importJob.update.mockResolvedValue({});

			await service.processQueue("user-1");

			expect(fetchMock).not.toHaveBeenCalled();
			expect(db.importJob.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						status: "READY_FOR_REVIEW",
						totalTransactions: 1,
					}),
				}),
			);
		});
	});

	describe("a queued statement with the setting on", () => {
		it("goes to the sidecar, on the provider the account uses", async () => {
			optedIn(true);
			db.importJob.findFirst
				.mockResolvedValueOnce(queuedJob("pdf", "JVBERg=="))
				.mockResolvedValueOnce(null);
			db.importJob.update.mockResolvedValue({});
			db.aiUsage.upsert.mockResolvedValue({});

			await service.processQueue("user-1");

			expect(fetchMock).toHaveBeenCalledTimes(1);
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("http://sidecar:8080/process");
			expect((init.body as FormData).get("provider")).toBe("local");
			expect(db.importJob.update).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({ status: "READY_FOR_REVIEW" }),
				}),
			);
		});
	});

	describe("createJob", () => {
		const input = (fileType: string) => ({
			fileName: `statement.${fileType}`,
			fileSize: 100,
			fileType,
			type: "BANK_STATEMENT" as const,
			fileData: BANK_CSV,
		});

		it("refuses a PDF while the setting is off", async () => {
			optedIn(false);
			await expect(service.createJob("user-1", input("pdf"))).rejects.toMatchObject(
				{ code: "FORBIDDEN", message: AI_IMPORT_OFF_MESSAGE },
			);
			expect(db.importJob.create).not.toHaveBeenCalled();
		});

		it("keeps a spreadsheet as a plain CSV job while the setting is off", async () => {
			optedIn(false);
			db.importJob.create.mockResolvedValue(queuedJob("csv", BANK_CSV, "CSV"));
			db.importJob.findFirst.mockResolvedValue(null);

			await service.createJob("user-1", input("csv"));

			expect(db.importJob.create).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({ type: "CSV" }),
				}),
			);
		});

		it("queues a PDF as a statement job when the setting is on", async () => {
			optedIn(true);
			db.importJob.create.mockResolvedValue(queuedJob("pdf", BANK_CSV));
			db.importJob.findFirst.mockResolvedValue(null);

			await service.createJob("user-1", input("pdf"));

			expect(db.importJob.create).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({ type: "BANK_STATEMENT" }),
				}),
			);
		});

		it("does not look at the setting for a plain CSV import", async () => {
			db.importJob.create.mockResolvedValue(queuedJob("csv", RETROSPEND_CSV, "CSV"));
			db.importJob.findFirst.mockResolvedValue(null);

			await service.createJob("user-1", { ...input("csv"), type: "CSV" });

			expect(db.user.findUnique).not.toHaveBeenCalled();
		});
	});
});

describe("the provider that would read a file", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("is OpenRouter with its model when the external model is in use", () => {
		expect(
			importProviderFor("EXTERNAL", { ollama: "qwen2.5:7b", openRouter: "qwen/q" }),
		).toEqual({ name: "OPENROUTER", model: "qwen/q" });
	});

	it("is Ollama with its model for local reading", () => {
		expect(
			importProviderFor("LOCAL", { ollama: "qwen2.5:7b", openRouter: "qwen/q" }),
		).toEqual({ name: "OLLAMA", model: "qwen2.5:7b" });
	});

	it("keeps the provider and drops the model when the sidecar is silent", () => {
		expect(importProviderFor("EXTERNAL", null)).toEqual({
			name: "OPENROUTER",
			model: null,
		});
	});

	it("reads both models from the sidecar's health route", async () => {
		const fetchMock = vi.fn(async (_url: string) =>
			Response.json({ llm_model: "qwen2.5:7b", openrouter_model: "qwen/q" }),
		);
		vi.stubGlobal("fetch", fetchMock);
		expect(await readSidecarModels()).toEqual({
			ollama: "qwen2.5:7b",
			openRouter: "qwen/q",
		});
		expect(fetchMock.mock.calls[0]?.[0]).toBe("http://sidecar:8080/health");
	});

	it("gives null when the sidecar cannot be reached", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("down");
			}),
		);
		expect(await readSidecarModels()).toBeNull();
	});
});
