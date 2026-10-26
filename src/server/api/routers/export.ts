import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { exportAccountZip } from "~/server/services/export/account-zip";
import type { ExportContext } from "~/server/services/export/context";
import {
	exportPersonHistory,
	exportPersonSettlementPlan,
} from "~/server/services/export/person-csv";
import { exportPersonPdf } from "~/server/services/export/person-pdf";
import {
	exportBillingPeriodSummary,
	exportProjectExpenses,
	exportSettlementPlan,
} from "~/server/services/export/project-csv";
import { exportProjectPdf } from "~/server/services/export/project-pdf";

/**
 * The export documents for the web app. The documents are built in
 * services/export (API v1 calls the same functions); this only checks the
 * input and base64-encodes the binary ones for the JSON response.
 */

const formatSchema = z.literal("csv");
const participantTypeSchema = z.enum(["user", "guest", "shadow"]);
const personSchema = z.object({
	participantType: participantTypeSchema,
	participantId: z.string().min(1),
});

const contextOf = (ctx: {
	db: ExportContext["db"];
	session: { user: { id: string } };
	timeZone: string;
}): ExportContext => ({
	db: ctx.db,
	userId: ctx.session.user.id,
	timeZone: ctx.timeZone,
});

const base64 = (doc: { pdf: Buffer; filename: string }) => ({
	pdf: doc.pdf.toString("base64"),
	filename: doc.filename,
});

export const exportRouter = createTRPCRouter({
	allData: protectedProcedure.mutation(async ({ ctx }) => {
		const zip = await exportAccountZip(
			ctx.db,
			ctx.session.user.id,
			ctx.timeZone,
		);
		return { zipData: zip.bytes.toString("base64"), filename: zip.filename };
	}),

	/** Every shared expense of a project, or of one billing period. */
	exportProjectExpenses: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				periodId: z.string().optional(),
				format: formatSchema,
			}),
		)
		.mutation(({ ctx, input }) => exportProjectExpenses(contextOf(ctx), input)),

	/** Every expense the user shares with one person. */
	exportPersonHistory: protectedProcedure
		.input(personSchema.extend({ format: formatSchema }))
		.mutation(({ ctx, input }) => exportPersonHistory(contextOf(ctx), input)),

	/** What is open between the user and one person, per currency. */
	exportPersonSettlementPlan: protectedProcedure
		.input(personSchema.extend({ format: formatSchema }))
		.mutation(({ ctx, input }) =>
			exportPersonSettlementPlan(contextOf(ctx), input),
		),

	exportPersonPdf: protectedProcedure
		.input(personSchema)
		.mutation(async ({ ctx, input }) =>
			base64(await exportPersonPdf(contextOf(ctx), input)),
		),

	/** One billing period: its expenses, then the settlement plan. */
	exportBillingPeriodSummary: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				periodId: z.string().min(1),
				format: formatSchema,
			}),
		)
		.mutation(({ ctx, input }) =>
			exportBillingPeriodSummary(contextOf(ctx), input),
		),

	/** Who pays whom to settle a project, or one billing period of it. */
	exportSettlementPlan: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				periodId: z.string().optional(),
				format: formatSchema,
			}),
		)
		.mutation(({ ctx, input }) => exportSettlementPlan(contextOf(ctx), input)),

	exportProjectPdf: protectedProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				periodId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) =>
			base64(await exportProjectPdf(contextOf(ctx), input)),
		),
});
