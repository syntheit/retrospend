import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
	type CommitImportInput,
	commitImport,
} from "~/server/services/import/commit.mutation";
import { recentImports } from "~/server/services/import/recent";
import { importReview } from "~/server/services/import/review";
import { IMPORT_KINDS } from "~/server/services/import/rows";
import { importRunner } from "~/server/services/import/runner";
import { undoImport } from "~/server/services/import/undo.mutation";

const currency = z
	.string()
	.regex(/^[A-Za-z0-9]{3,10}$/)
	.nullish();

const commitSchema = z.object({
	jobId: z.string().min(1).max(64),
	currency,
	rows: z
		.array(
			z.object({
				index: z.number().int().min(0),
				keep: z.boolean(),
				categoryId: z.string().min(1).max(64).nullable(),
				kind: z.enum(IMPORT_KINDS),
			}),
		)
		.max(5000),
});

type Ctx = { session: { user: { id: string } }; timeZone?: string };

const commitInput = (
	value: z.infer<typeof commitSchema>,
	ctx: Ctx,
): CommitImportInput => ({ ...value, timeZone: ctx.timeZone });

/**
 * The Import page (S4B part 2), next to today's queue procedures:
 * Recent imports, the Review read model, and the commit with its preview
 * (R30) and its undo. Uploading and the queue (createJob, cancelJob,
 * deleteJob) stay in import-queue.ts.
 */
export const importV2Router = createTRPCRouter({
	recent: protectedProcedure.query(({ ctx }) =>
		recentImports(ctx.db, ctx.session.user.id),
	),

	review: protectedProcedure
		.input(z.object({ jobId: z.string().min(1).max(64), currency }))
		.query(({ ctx, input }) =>
			importReview(ctx.db, ctx.session.user.id, input.jobId, {
				currency: input.currency,
				timeZone: ctx.timeZone,
			}),
		),

	/** The Import sheet's preview: the same write, rolled back. */
	commitPreview: protectedProcedure
		.input(commitSchema)
		.query(({ ctx, input }) =>
			importRunner(ctx.session.user.id).preview(
				commitImport,
				commitInput(input, ctx),
			),
		),

	commit: protectedProcedure
		.input(commitSchema)
		.mutation(({ ctx, input }) =>
			importRunner(ctx.session.user.id).apply(
				commitImport,
				commitInput(input, ctx),
			),
		),

	/** Undo import: deletes the batch and makes the file reviewable again. */
	undo: protectedProcedure
		.input(z.object({ jobId: z.string().min(1).max(64) }))
		.mutation(({ ctx, input }) =>
			importRunner(ctx.session.user.id).apply(undoImport, {
				...input,
				timeZone: ctx.timeZone,
			}),
		),
});
