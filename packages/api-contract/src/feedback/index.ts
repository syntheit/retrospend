import * as z from "zod";
import { v1 } from "../common/meta";
import { userText } from "../common/user-text";
import { idSchema, okSchema } from "../core";

import {
	ERROR_REPORT_BATCH_MAX,
	FEEDBACK_SCREENSHOT_MAX_BYTES,
} from "./client";

export * from "./client";

export const FEEDBACK_CATEGORIES = ["bug", "idea", "other"] as const;

export const feedbackCategorySchema = z
	.enum(FEEDBACK_CATEGORIES)
	.meta({ id: "FeedbackCategory" });

export const ERROR_REPORT_KINDS = ["crash", "rejection", "render"] as const;

/**
 * One recorded error. The app scrubs addresses, tokens and numbers before it
 * keeps one, and the server never trusts that: it is stored as text only.
 */
export const errorReportSchema = z
	.object({
		kind: z.enum(ERROR_REPORT_KINDS),
		message: z.string().max(500),
		stack: z.string().max(4000).optional(),
		/** The route the app was on, without ids or query. */
		screen: z.string().max(200).optional(),
		appVersion: z.string().max(32).optional(),
		build: z.string().max(32).optional(),
		os: z.string().max(64).optional(),
		device: z.string().max(64).optional(),
		occurredAt: z.iso.datetime({ offset: true }),
	})
	.meta({ id: "ErrorReport" });

export type ErrorReportInput = z.infer<typeof errorReportSchema>;

export const submitErrorReportsSchema = z
	.object({
		reports: z.array(errorReportSchema).min(1).max(ERROR_REPORT_BATCH_MAX),
	})
	.meta({ id: "SubmitErrorReports" });

/** What the person chose to include with their feedback. */
export const feedbackDiagnosticsSchema = z
	.object({
		appVersion: z.string().max(32).optional(),
		build: z.string().max(32).optional(),
		os: z.string().max(64).optional(),
		device: z.string().max(64).optional(),
		locale: z.string().max(32).optional(),
		serverVersion: z.string().max(32).optional(),
		recentErrors: z.array(errorReportSchema).max(10).optional(),
	})
	.meta({ id: "FeedbackDiagnostics" });

export type FeedbackDiagnostics = z.infer<typeof feedbackDiagnosticsSchema>;

export const submitFeedbackSchema = z
	.object({
		message: userText("feedback.message", 5000),
		/** The screen it was written on. */
		pageUrl: z.string().max(2048),
		userAgent: z.string().max(512).optional(),
		viewportSize: z.string().max(32).optional(),
		appVersion: z.string().max(32).optional(),
		category: feedbackCategorySchema.default("other"),
		diagnostics: feedbackDiagnosticsSchema.optional(),
	})
	.meta({ id: "SubmitFeedback" });

export type SubmitFeedback = z.infer<typeof submitFeedbackSchema>;

export const feedbackSentSchema = z
	.object({ ok: z.literal(true), id: idSchema })
	.meta({ id: "FeedbackSent" });

export const feedbackScreenshotSchema = z.object({
	id: idSchema,
	file: z.file().max(FEEDBACK_SCREENSHOT_MAX_BYTES).meta({
		description:
			"JPEG, PNG, WebP or GIF up to 5 MB; stored as a WebP at most 1200 pixels wide.",
	}),
});

/**
 * Feedback goes to the server's admins. Reading it is an admin route
 * (GET /admin/feedback); a user can only send. Five entries per hour.
 */
export const feedbackContract = {
	submit: v1
		.route({
			method: "POST",
			path: "/feedback",
			operationId: "submitFeedback",
			tags: ["Feedback"],
			summary: "Send feedback to the admins",
			description:
				"Answers 409 after 5 entries in an hour. Admins are emailed when the server has email on. The answer carries the id to attach a screenshot to.",
			successStatus: 201,
		})
		.meta({ scope: "write:settings", event: "feedback.submitted" })
		.input(submitFeedbackSchema)
		.output(feedbackSentSchema),
	attachScreenshot: v1
		.route({
			method: "PUT",
			path: "/feedback/{id}/screenshot",
			operationId: "attachFeedbackScreenshot",
			tags: ["Feedback"],
			summary:
				"Attach a screenshot to feedback you sent (multipart/form-data, field file)",
			description:
				"Only the sender can attach, and a new file replaces the old one. The picture is private: only admins read it.",
		})
		.meta({ scope: "write:settings", event: "feedback.screenshot_attached" })
		.input(feedbackScreenshotSchema)
		.output(okSchema),
	submitErrorReports: v1
		.route({
			method: "POST",
			path: "/error-reports",
			operationId: "submitErrorReports",
			tags: ["Feedback"],
			summary: "Send the app's recorded crashes to the admins",
			description:
				"Up to 20 reports a call. Admins read them at GET /admin/error-reports.",
			successStatus: 201,
		})
		.meta({ scope: "write:settings", event: "feedback.error_reports_sent" })
		.input(submitErrorReportsSchema)
		.output(z.object({ ok: z.literal(true), stored: z.int().min(0) })),
};
