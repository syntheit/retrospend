import * as z from "zod";
import { idSchema, timestampSchema } from "../core";

/** How long a finished export stays downloadable. */
export const EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** How long one download link works; read the job again for a new one. */
export const EXPORT_LINK_TTL_MS = 10 * 60 * 1000;

export const EXPORT_KINDS = [
	"data",
	"expenses",
	"project_expenses",
	"project_settlement_plan",
	"project_billing_period",
	"project_pdf",
	"person_history",
	"person_settlement_plan",
	"person_pdf",
] as const;

export const EXPORT_FORMATS = ["zip", "csv", "pdf"] as const;

export const EXPORT_STATES = [
	"queued",
	"running",
	"ready",
	"failed",
	"expired",
] as const;

const person = {
	participantType: z.enum(["user", "guest", "shadow"]),
	participantId: idSchema,
};

/**
 * What to export. `data` is everything you own as a zip of CSV files;
 * `expenses` is your expenses as one CSV; the rest are the project and person documents the web app offers (CSV or
 * PDF). Ids only: no text goes in a request.
 */
export const exportRequestSchema = z
	.discriminatedUnion("kind", [
		z.object({ kind: z.literal("data") }),
		z.object({
			kind: z.literal("expenses"),
			expenseIds: z.array(idSchema).min(1).max(5000).optional().meta({
				description:
					"Only these expenses; every finalized expense when omitted.",
			}),
		}),
		z.object({
			kind: z.literal("project_expenses"),
			projectId: idSchema,
			periodId: idSchema.optional(),
		}),
		z.object({
			kind: z.literal("project_settlement_plan"),
			projectId: idSchema,
			periodId: idSchema.optional(),
		}),
		z.object({
			kind: z.literal("project_billing_period"),
			projectId: idSchema,
			periodId: idSchema,
		}),
		z.object({
			kind: z.literal("project_pdf"),
			projectId: idSchema,
			periodId: idSchema.optional(),
		}),
		z.object({ kind: z.literal("person_history"), ...person }),
		z.object({ kind: z.literal("person_settlement_plan"), ...person }),
		z.object({ kind: z.literal("person_pdf"), ...person }),
	])
	.meta({ id: "ExportRequest" });

export type ExportRequest = z.infer<typeof exportRequestSchema>;

export const exportDownloadSchema = z
	.object({
		/** A path under /api/v1. Send the same credentials you use for the API. */
		url: z.string(),
		expiresAt: timestampSchema,
	})
	.meta({ id: "ExportDownload" });

export const exportJobSchema = z
	.object({
		id: idSchema,
		kind: z.enum(EXPORT_KINDS),
		format: z.enum(EXPORT_FORMATS),
		state: z.enum(EXPORT_STATES),
		/** Set once the file exists. */
		fileName: z.string().nullable(),
		sizeBytes: z.int().min(0).nullable(),
		error: z.string().nullable(),
		createdAt: timestampSchema,
		completedAt: timestampSchema.nullable(),
		/** When the file is deleted. */
		expiresAt: timestampSchema,
		/** A fresh short-lived link, only while the job is ready. */
		download: exportDownloadSchema.nullable(),
	})
	.meta({ id: "ExportJob" });

export type ExportJobDto = z.infer<typeof exportJobSchema>;

export const exportJobParamsSchema = z.object({ id: idSchema });

export const exportDownloadQuerySchema = exportJobParamsSchema.extend({
	token: z.string().min(1).max(200),
});
