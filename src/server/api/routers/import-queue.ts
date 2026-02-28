import { z } from "zod";
import {
	adminProcedure,
	createTRPCRouter,
	protectedProcedure,
} from "~/server/api/trpc";
import { ImportQueueService } from "~/server/services/import-queue.service";

// ── Input Schemas ─────────────────────────────────────────────────────

const createJobSchema = z.object({
	fileName: z.string().min(1).max(255),
	fileSize: z.number().int().positive(),
	fileType: z.enum(["csv", "xlsx", "pdf"]),
	type: z.enum(["CSV", "BANK_STATEMENT"]),
	fileData: z.string().min(1), // base64 encoded
});

const importerTransactionSchema = z.object({
	title: z.string(),
	amount: z.number(),
	currency: z.string(),
	exchangeRate: z.number(),
	amountInUSD: z.number(),
	date: z.string(), // YYYY-MM-DD
	location: z.string(),
	description: z.string(),
	pricingSource: z.string(),
	category: z.string(),
});

const finalizeImportSchema = z.object({
	selectedTransactions: z.array(importerTransactionSchema),
});

const listJobsSchema = z
	.object({
		limit: z.number().int().positive().max(100).optional(),
		includeCompleted: z.boolean().optional(),
	})
	.optional();

// ── Router ────────────────────────────────────────────────────────────

export const importQueueRouter = createTRPCRouter({
	/**
	 * Creates a new import job and triggers queue processing.
	 */
	createJob: protectedProcedure
		.input(createJobSchema)
		.mutation(async ({ ctx, input }) => {
			const service = new ImportQueueService(ctx.db);
			return await service.createJob(ctx.session.user.id, input);
		}),

	/**
	 * Lists jobs for the current user.
	 */
	listJobs: protectedProcedure
		.input(listJobsSchema)
		.query(async ({ ctx, input }) => {
			const service = new ImportQueueService(ctx.db);
			return await service.listJobs(ctx.session.user.id, input ?? {});
		}),

	/**
	 * Gets a single job by ID.
	 */
	getJob: protectedProcedure
		.input(z.object({ jobId: z.string() }))
		.query(async ({ ctx, input }) => {
			const service = new ImportQueueService(ctx.db);
			return await service.getJob(ctx.session.user.id, input.jobId);
		}),

	/**
	 * Gets queue status summary.
	 */
	getQueueStatus: protectedProcedure.query(async ({ ctx }) => {
		const service = new ImportQueueService(ctx.db);
		return await service.getQueueStatus(ctx.session.user.id);
	}),

	/**
	 * Marks a job as reviewing (when modal opens).
	 */
	startReview: protectedProcedure
		.input(z.object({ jobId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const service = new ImportQueueService(ctx.db);
			return await service.startReview(ctx.session.user.id, input.jobId);
		}),

	/**
	 * Finalizes import by inserting selected expenses into database.
	 */
	finalizeImport: protectedProcedure
		.input(
			z.object({
				jobId: z.string(),
				selectedTransactions: z.array(importerTransactionSchema),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const service = new ImportQueueService(ctx.db);
			return await service.finalizeImport(ctx.session.user.id, input.jobId, {
				selectedTransactions: input.selectedTransactions,
			});
		}),

	/**
	 * Cancels a queued job.
	 */
	cancelJob: protectedProcedure
		.input(z.object({ jobId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const service = new ImportQueueService(ctx.db);
			return await service.cancelJob(ctx.session.user.id, input.jobId);
		}),

	/**
	 * Deletes a completed or failed job.
	 */
	deleteJob: protectedProcedure
		.input(z.object({ jobId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const service = new ImportQueueService(ctx.db);
			return await service.deleteJob(ctx.session.user.id, input.jobId);
		}),

	/**
	 * Gets global queue statistics (admin only).
	 */
	getGlobalStats: adminProcedure.query(async ({ ctx }) => {
		const service = new ImportQueueService(ctx.db);
		return await service.getGlobalStats();
	}),
});
