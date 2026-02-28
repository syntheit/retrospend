import { TRPCError } from "@trpc/server";
import * as XLSX from "xlsx";
import { env } from "~/env";
import { parseRawCsv } from "~/lib/csv";
import { parseDateOnly } from "~/lib/date";
import { generateId } from "~/lib/id";
import type { Prisma, PrismaClient } from "~prisma";
import { CsvService } from "./csv.service";

// ── Types ─────────────────────────────────────────────────────────────

export interface ImporterTransaction {
	title: string;
	amount: number;
	currency: string;
	exchangeRate: number;
	amountInUSD: number;
	date: string; // YYYY-MM-DD
	location: string;
	description: string;
	pricingSource: string;
	category: string;
}

export interface CreateJobInput {
	fileName: string;
	fileSize: number;
	fileType: string; // "csv" | "xlsx" | "pdf"
	type: "CSV" | "BANK_STATEMENT";
	fileData: string; // base64 encoded
}

export interface FinalizeImportInput {
	selectedTransactions: ImporterTransaction[];
}

// ── Constants ─────────────────────────────────────────────────────────

const MAX_PENDING_JOBS = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// ── Service ───────────────────────────────────────────────────────────

export class ImportQueueService {
	constructor(private db: PrismaClient | Prisma.TransactionClient) {}

	/**
	 * Creates a new import job and triggers queue processing.
	 */
	async createJob(userId: string, input: CreateJobInput) {
		// Validate file size
		if (input.fileSize > MAX_FILE_SIZE) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
			});
		}

		// Check pending job limit
		const pendingCount = await this.db.importJob.count({
			where: {
				userId,
				status: { in: ["QUEUED", "PROCESSING"] },
			},
		});

		if (pendingCount >= MAX_PENDING_JOBS) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Maximum of ${MAX_PENDING_JOBS} pending import jobs reached. Please wait for current jobs to complete.`,
			});
		}

		// Create the job
		const job = await this.db.importJob.create({
			data: {
				id: generateId(),
				userId,
				status: "QUEUED",
				type: input.type,
				fileName: input.fileName,
				fileSize: input.fileSize,
				fileType: input.fileType,
				fileData: input.fileData,
			},
		});

		// Trigger queue processing asynchronously (don't await)
		// This allows the mutation to return immediately
		void this.processQueue(userId).catch((error) => {
			console.error(
				`Queue processing error for user ${userId}:`,
				error,
			);
		});

		return job;
	}

	/**
	 * Checks if we can start processing a new job (respects global concurrency limit).
	 */
	private async canStartProcessing(): Promise<boolean> {
		const globalProcessingCount = await this.db.importJob.count({
			where: { status: "PROCESSING" },
		});

		return globalProcessingCount < env.MAX_CONCURRENT_IMPORT_JOBS;
	}

	/**
	 * Processes the next queued job for a user.
	 */
	async processQueue(userId: string): Promise<void> {
		// Check if we can start processing (global concurrency limit)
		const canProcess = await this.canStartProcessing();
		if (!canProcess) {
			// At global limit, job stays in QUEUED
			return;
		}

		// Get next QUEUED job for this user
		const job = await this.db.importJob.findFirst({
			where: { userId, status: "QUEUED" },
			orderBy: { createdAt: "asc" },
		});

		if (!job) {
			return; // Queue empty
		}

		try {
			// Update to PROCESSING
			await this.db.importJob.update({
				where: { id: job.id },
				data: {
					status: "PROCESSING",
					processingAt: new Date(),
				},
			});

			// Process based on type
			if (job.type === "CSV") {
				await this.processCsvJob(job);
			} else if (job.type === "BANK_STATEMENT") {
				await this.processBankStatementJob(job);
			}

			// Process next job recursively
			await this.processQueue(userId);
		} catch (error) {
			console.error(`Job processing error for ${job.id}:`, error);

			// Mark as FAILED
			await this.db.importJob.update({
				where: { id: job.id },
				data: {
					status: "FAILED",
					errorMessage:
						error instanceof Error
							? error.message.substring(0, 1000)
							: "Unknown error",
					failedAt: new Date(),
					fileData: null, // Clear file data
				},
			});

			// Trigger global queue processing (job slot freed up)
			void this.processGlobalQueue().catch((err) => {
				console.error("Global queue processing error:", err);
			});

			// Continue with next job for this user
			await this.processQueue(userId);
		}
	}

	/**
	 * Processes queued jobs globally across all users (respecting concurrency limit).
	 * Called when jobs complete/fail to fill up freed slots.
	 */
	async processGlobalQueue(): Promise<void> {
		// Get all users with queued jobs
		const queuedJobs = await this.db.importJob.findMany({
			where: { status: "QUEUED" },
			select: { userId: true },
			distinct: ["userId"],
		});

		// Trigger processing for each user (they will check global limit)
		for (const { userId } of queuedJobs) {
			void this.processQueue(userId).catch((err) => {
				console.error(`Queue processing error for user ${userId}:`, err);
			});
		}
	}

	/**
	 * Processes a CSV import job (supports CSV and XLSX files).
	 */
	private async processCsvJob(job: {
		id: string;
		fileData: string | null;
		fileName: string;
	}): Promise<void> {
		if (!job.fileData) {
			throw new Error("No file data found for CSV job");
		}

		// Decode base64 fileData
		const fileBuffer = Buffer.from(job.fileData, "base64");

		let csvContent: string;
		const additionalWarnings: string[] = [];

		// Check if file is XLSX (by extension)
		if (job.fileName.toLowerCase().endsWith(".xlsx")) {
			// Convert XLSX to CSV
			try {
				const workbook = XLSX.read(fileBuffer, { type: "buffer" });

				// Check for multiple sheets and warn
				if (workbook.SheetNames.length > 1) {
					additionalWarnings.push(
						`Excel file contains ${workbook.SheetNames.length} sheets. Only the first sheet "${workbook.SheetNames[0]}" will be imported.`
					);
				}

				// Get first sheet
				const firstSheetName = workbook.SheetNames[0];
				if (!firstSheetName) {
					throw new Error("Excel file contains no sheets");
				}

				const worksheet = workbook.Sheets[firstSheetName];
				if (!worksheet) {
					throw new Error("Failed to read Excel sheet");
				}

				// Convert to CSV
				csvContent = XLSX.utils.sheet_to_csv(worksheet);

				if (!csvContent.trim()) {
					throw new Error("Excel sheet is empty");
				}
			} catch (error) {
				throw new Error(
					`Failed to process Excel file: ${error instanceof Error ? error.message : "Unknown error"}`
				);
			}
		} else {
			// Regular CSV file
			csvContent = fileBuffer.toString("utf-8");
		}

		// Parse using existing parseRawCsv()
		const { data: rawRows, errors } = parseRawCsv(csvContent);

		if (errors.length > 0) {
			throw new Error(`CSV parsing errors: ${errors.join(", ")}`);
		}

		if (rawRows.length === 0) {
			throw new Error("CSV file is empty");
		}

		// Convert to ImporterTransaction format
		const transactions: ImporterTransaction[] = [];
		const warnings: string[] = [...additionalWarnings];

		for (let i = 0; i < rawRows.length; i++) {
			const row = rawRows[i]!;

			try {
				// Extract and validate required fields
				const title = row.title?.trim();
				const amountStr = row.amount?.trim();
				const currency = row.currency?.trim().toUpperCase();
				const dateStr = row.date?.trim();

				if (!title) {
					warnings.push(`Row ${i + 1}: Missing title, skipping`);
					continue;
				}

				if (!amountStr) {
					warnings.push(`Row ${i + 1}: Missing amount, skipping`);
					continue;
				}

				const amount = parseFloat(amountStr);
				if (isNaN(amount) || amount <= 0) {
					warnings.push(
						`Row ${i + 1}: Invalid amount "${amountStr}", skipping`,
					);
					continue;
				}

				if (!currency || currency.length !== 3) {
					warnings.push(
						`Row ${i + 1}: Invalid currency "${currency}", skipping`,
					);
					continue;
				}

				if (!dateStr) {
					warnings.push(`Row ${i + 1}: Missing date, skipping`);
					continue;
				}

				let date: Date;
				try {
					date = parseDateOnly(dateStr);
				} catch {
					warnings.push(
						`Row ${i + 1}: Invalid date "${dateStr}", skipping`,
					);
					continue;
				}

				// Extract optional fields
				const exchangeRateStr = row.exchangerate?.trim();
				const amountInUSDStr = row.amountinusd?.trim();
				const location = row.location?.trim() || "";
				const description = row.description?.trim() || "";
				const category = row.category?.trim() || "";
				const pricingSource = row.pricingsource?.trim() || "IMPORT";

				// Calculate exchange rate and USD amount
				let exchangeRate: number;
				let amountInUSD: number;

				if (currency === "USD") {
					exchangeRate = 1;
					amountInUSD = amount;
				} else if (exchangeRateStr) {
					exchangeRate = parseFloat(exchangeRateStr);
					if (isNaN(exchangeRate) || exchangeRate <= 0) {
						warnings.push(
							`Row ${i + 1}: Invalid exchange rate "${exchangeRateStr}", skipping`,
						);
						continue;
					}
					amountInUSD = amount / exchangeRate;
				} else if (amountInUSDStr) {
					amountInUSD = parseFloat(amountInUSDStr);
					if (isNaN(amountInUSD) || amountInUSD <= 0) {
						warnings.push(
							`Row ${i + 1}: Invalid USD amount "${amountInUSDStr}", skipping`,
						);
						continue;
					}
					exchangeRate = amount / amountInUSD;
				} else {
					warnings.push(
						`Row ${i + 1}: Missing exchange rate or USD amount for ${currency}, skipping`,
					);
					continue;
				}

				transactions.push({
					title,
					amount,
					currency,
					exchangeRate,
					amountInUSD,
					date: date.toISOString().split("T")[0]!,
					location,
					description,
					pricingSource,
					category,
				});
			} catch (error) {
				warnings.push(
					`Row ${i + 1}: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}

		if (transactions.length === 0) {
			throw new Error(
				"No valid transactions found in CSV. " +
					(warnings.length > 0
						? `Warnings: ${warnings.slice(0, 3).join("; ")}`
						: ""),
			);
		}

		// Store transactions and clear file data
		await this.db.importJob.update({
			where: { id: job.id },
			data: {
				status: "READY_FOR_REVIEW",
				transactions: transactions as unknown as Prisma.InputJsonValue,
				warnings:
					warnings.length > 0
						? (warnings as unknown as Prisma.InputJsonValue)
						: undefined,
				totalTransactions: transactions.length,
				readyForReviewAt: new Date(),
				fileData: null, // Clear file data after processing
			},
		});
	}

	/**
	 * Processes a bank statement import job (supports PDF, CSV, and XLSX).
	 */
	private async processBankStatementJob(job: {
		id: string;
		userId: string;
		fileData: string | null;
		fileName: string;
		fileType: string;
	}): Promise<void> {
		if (!job.fileData) {
			throw new Error("No file data found for bank statement job");
		}

		// Check importer is configured
		const importerUrl = env.IMPORTER_URL;
		if (!importerUrl) {
			throw new Error(
				"Bank statement import is not configured on this instance",
			);
		}

		const apiKey = env.WORKER_API_KEY;
		if (!apiKey) {
			throw new Error("Importer authentication is not configured");
		}

		// Decode base64 file data
		let fileBuffer = Buffer.from(job.fileData, "base64");
		let fileName = job.fileName;
		let fileType = job.fileType;
		const additionalWarnings: string[] = [];

		// Convert XLSX to CSV if needed
		if (job.fileName.toLowerCase().endsWith(".xlsx")) {
			try {
				const workbook = XLSX.read(fileBuffer, { type: "buffer" });

				// Check for multiple sheets and warn
				if (workbook.SheetNames.length > 1) {
					additionalWarnings.push(
						`Excel file contains ${workbook.SheetNames.length} sheets. Only the first sheet "${workbook.SheetNames[0]}" will be processed.`
					);
				}

				// Get first sheet
				const firstSheetName = workbook.SheetNames[0];
				if (!firstSheetName) {
					throw new Error("Excel file contains no sheets");
				}

				const worksheet = workbook.Sheets[firstSheetName];
				if (!worksheet) {
					throw new Error("Failed to read Excel sheet");
				}

				// Convert to CSV
				const csvContent = XLSX.utils.sheet_to_csv(worksheet);

				if (!csvContent.trim()) {
					throw new Error("Excel sheet is empty");
				}

				// Update file data to CSV
				fileBuffer = Buffer.from(csvContent, "utf-8");
				fileName = job.fileName.replace(/\.xlsx$/i, ".csv");
				fileType = "csv";
			} catch (error) {
				throw new Error(
					`Failed to process Excel file: ${error instanceof Error ? error.message : "Unknown error"}`
				);
			}
		}

		// Create form data for Go importer
		const formData = new FormData();
		const blob = new Blob([fileBuffer], {
			type:
				fileType === "pdf"
					? "application/pdf"
					: "text/csv",
		});
		formData.append("file", blob, fileName);

		// Call Go importer service
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 minutes

		try {
			const response = await fetch(`${importerUrl}/process`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
				},
				body: formData,
				signal: controller.signal,
			});

			if (!response.ok) {
				const errorText = await response
					.text()
					.catch(() => "Unknown error");
				throw new Error(
					`Importer service error [${response.status}]: ${errorText}`,
				);
			}

			// Handle streaming NDJSON response
			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error("No response body from importer");
			}

			const decoder = new TextDecoder();
			let transactions: ImporterTransaction[] = [];
			const warnings: string[] = [...additionalWarnings];
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");

				// Keep the last incomplete line in the buffer
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (!line.trim()) continue;

					try {
						const data = JSON.parse(line);

						if (data.type === "progress") {
							// Update job progress
							await this.db.importJob.update({
								where: { id: job.id },
								data: {
									progressPercent: data.percent / 100,
									statusMessage: data.message,
								},
							});
						} else if (data.type === "warning") {
							warnings.push(data.message);
						} else if (data.type === "result") {
							transactions = data.data;
						} else if (data.type === "error") {
							throw new Error(data.message);
						}
					} catch (error) {
						console.error(
							`Failed to parse importer response line: ${line}`,
							error,
						);
					}
				}
			}

			// Process any remaining buffer
			if (buffer.trim()) {
				try {
					const data = JSON.parse(buffer);
					if (data.type === "result") {
						transactions = data.data;
					} else if (data.type === "error") {
						throw new Error(data.message);
					}
				} catch (error) {
					console.error(
						`Failed to parse final buffer: ${buffer}`,
						error,
					);
				}
			}

			if (transactions.length === 0) {
				throw new Error("No transactions extracted from statement");
			}

			// Store results in job
			await this.db.importJob.update({
				where: { id: job.id },
				data: {
					status: "READY_FOR_REVIEW",
					transactions:
						transactions as unknown as Prisma.InputJsonValue,
					warnings:
						warnings.length > 0
							? (warnings as unknown as Prisma.InputJsonValue)
							: undefined,
					totalTransactions: transactions.length,
					readyForReviewAt: new Date(),
					fileData: null, // Clear file data after processing
					progressPercent: 1,
					statusMessage: "Complete",
				},
			});
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				throw new Error(
					"Bank statement processing timed out (5 minutes). The file may be too large.",
				);
			}
			throw error;
		} finally {
			clearTimeout(timeout);
		}
	}

	/**
	 * Updates job status to REVIEWING (when modal opens).
	 */
	async startReview(userId: string, jobId: string) {
		const job = await this.db.importJob.findUnique({
			where: { id: jobId },
		});

		if (!job) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Import job not found",
			});
		}

		if (job.userId !== userId) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Not authorized to access this job",
			});
		}

		if (job.status !== "READY_FOR_REVIEW") {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Job is not ready for review",
			});
		}

		return await this.db.importJob.update({
			where: { id: jobId },
			data: {
				status: "REVIEWING",
				reviewingAt: new Date(),
			},
		});
	}

	/**
	 * Finalizes import by calling CsvService to insert expenses.
	 */
	async finalizeImport(
		userId: string,
		jobId: string,
		input: FinalizeImportInput,
	) {
		const job = await this.db.importJob.findUnique({
			where: { id: jobId },
		});

		if (!job) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Import job not found",
			});
		}

		if (job.userId !== userId) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Not authorized to access this job",
			});
		}

		if (job.status !== "REVIEWING") {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Job must be in reviewing state to finalize",
			});
		}

		// Convert ImporterTransactions to ImportExpenseRow format
		const rows = input.selectedTransactions.map((t) => ({
			title: t.title,
			amount: t.amount,
			currency: t.currency,
			date: parseDateOnly(t.date),
			exchangeRate: t.exchangeRate,
			amountInUSD: t.amountInUSD,
			location: t.location || null,
			description: t.description || null,
			categoryId: null, // Categories are mapped client-side
			pricingSource: t.pricingSource || "IMPORT",
		}));

		// Use CsvService to do the actual import (handles duplicates, validation, etc.)
		const csvService = new CsvService(this.db);
		const result = await csvService.importExpensesFromRows(userId, rows);

		// Mark job as COMPLETED
		await this.db.importJob.update({
			where: { id: jobId },
			data: {
				status: "COMPLETED",
				completedAt: new Date(),
				importedCount: result.count,
				skippedDuplicates: result.skippedDuplicates,
			},
		});

		// Trigger global queue processing (job slot freed up)
		void this.processGlobalQueue().catch((err) => {
			console.error("Global queue processing error:", err);
		});

		return result;
	}

	/**
	 * Gets a single job by ID.
	 */
	async getJob(userId: string, jobId: string) {
		const job = await this.db.importJob.findUnique({
			where: { id: jobId },
		});

		if (!job) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Import job not found",
			});
		}

		if (job.userId !== userId) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Not authorized to access this job",
			});
		}

		return job;
	}

	/**
	 * Lists jobs for a user with optional filtering.
	 */
	async listJobs(
		userId: string,
		options?: {
			limit?: number;
			includeCompleted?: boolean;
		},
	) {
		const { limit = 50, includeCompleted = true } = options ?? {};

		const jobs = await this.db.importJob.findMany({
			where: {
				userId,
				...(includeCompleted
					? {}
					: { status: { notIn: ["COMPLETED", "CANCELLED"] } }),
			},
			orderBy: { createdAt: "desc" },
			take: limit,
		});

		return jobs;
	}

	/**
	 * Gets queue status summary for a user.
	 */
	async getQueueStatus(userId: string) {
		const jobs = await this.db.importJob.findMany({
			where: {
				userId,
				status: {
					in: [
						"QUEUED",
						"PROCESSING",
						"READY_FOR_REVIEW",
						"REVIEWING",
					],
				},
			},
			orderBy: { createdAt: "asc" },
		});

		const processing = jobs.filter((j) => j.status === "PROCESSING");
		const queued = jobs.filter((j) => j.status === "QUEUED");
		const readyForReview = jobs.filter(
			(j) => j.status === "READY_FOR_REVIEW",
		);
		const reviewing = jobs.filter((j) => j.status === "REVIEWING");

		return {
			processing,
			queued,
			readyForReview,
			reviewing,
			queuedCount: queued.length,
		};
	}

	/**
	 * Gets global queue statistics (admin only).
	 */
	async getGlobalStats() {
		const [
			totalProcessing,
			totalQueued,
			totalReadyForReview,
			totalReviewing,
		] = await Promise.all([
			this.db.importJob.count({ where: { status: "PROCESSING" } }),
			this.db.importJob.count({ where: { status: "QUEUED" } }),
			this.db.importJob.count({ where: { status: "READY_FOR_REVIEW" } }),
			this.db.importJob.count({ where: { status: "REVIEWING" } }),
		]);

		return {
			maxConcurrent: env.MAX_CONCURRENT_IMPORT_JOBS,
			currentProcessing: totalProcessing,
			availableSlots:
				env.MAX_CONCURRENT_IMPORT_JOBS - totalProcessing,
			totalQueued,
			totalReadyForReview,
			totalReviewing,
		};
	}

	/**
	 * Cancels a queued job.
	 */
	async cancelJob(userId: string, jobId: string) {
		const job = await this.db.importJob.findUnique({
			where: { id: jobId },
		});

		if (!job) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Import job not found",
			});
		}

		if (job.userId !== userId) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Not authorized to access this job",
			});
		}

		if (job.status !== "QUEUED") {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Only queued jobs can be cancelled",
			});
		}

		const cancelled = await this.db.importJob.update({
			where: { id: jobId },
			data: {
				status: "CANCELLED",
				fileData: null, // Clear file data
			},
		});

		// Trigger global queue processing (job slot potentially freed up)
		void this.processGlobalQueue().catch((err) => {
			console.error("Global queue processing error:", err);
		});

		return cancelled;
	}

	/**
	 * Deletes a completed or failed job.
	 */
	async deleteJob(userId: string, jobId: string) {
		const job = await this.db.importJob.findUnique({
			where: { id: jobId },
		});

		if (!job) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Import job not found",
			});
		}

		if (job.userId !== userId) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "Not authorized to access this job",
			});
		}

		if (!["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Only completed, failed, or cancelled jobs can be deleted",
			});
		}

		await this.db.importJob.delete({
			where: { id: jobId },
		});

		// Trigger global queue processing (in case job was stuck in PROCESSING)
		void this.processGlobalQueue().catch((err) => {
			console.error("Global queue processing error:", err);
		});

		return { success: true };
	}
}
