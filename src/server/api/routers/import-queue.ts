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
	exchangeRate: z.number().positive().optional(),
	amountInUSD: z.number().positive().optional(),
	date: z.string().max(10), // YYYY-MM-DD
	location: z.string().max(500),
	description: z.string().max(2000),
	pricingSource: z.string().max(200),
	category: z.string().max(200),
	categoryId: z.string().optional(),
	excludeFromAnalytics: z.boolean().optional(),
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
