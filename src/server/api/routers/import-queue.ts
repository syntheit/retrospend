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
	fileData: z.string().min(1).max(14_000_000), // base64 encoded, ~10MB file limit
});

const importerTransactionSchema = z.object({
	title: z.string().min(1).max(500),
	amount: z.number().positive(),
	currency: z.string().min(1).max(10),
	exchangeRate: z.number().positive(),
	amountInUSD: z.number().positive(),
	date: z.string().max(10), // YYYY-MM-DD
	location: z.string().max(500),
	description: z.string().max(2000),
	pricingSource: z.string().max(200),
	category: z.string().max(200),
	categoryId: z.string().cuid().optional(),
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
		.input(z.object({ jobId: z.string().cuid() }))
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
		.input(z.object({ jobId: z.string().cuid() }))
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
				jobId: z.string().cuid(),
				selectedTransactions: z.array(importerTransactionSchema).max(5000),
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
		.input(z.object({ jobId: z.string().cuid() }))
		.mutation(async ({ ctx, input }) => {
			const service = new ImportQueueService(ctx.db);
			return await service.cancelJob(ctx.session.user.id, input.jobId);
		}),

	/**
	 * Deletes a completed or failed job.
	 */
	deleteJob: protectedProcedure
		.input(z.object({ jobId: z.string().cuid() }))
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
