import * as z from "zod";
import { v1 } from "../common/meta";
import { moneySchema } from "../common/money";
import { idSchema, okSchema, timestampSchema } from "../core";
import { participantTypeSchema } from "../people/schemas";

const TAG = ["Activity"];

/** Mirrors AuditAction in prisma/schema.prisma; a test on the server side keeps the two equal. */
export const AUDIT_ACTIONS = [
	"FORGIVEN",
	"UNFORGIVEN",
	"CORRECTED",
	"CORRECTION_UNDONE",
	"FIX_REQUESTED",
	"FIX_ANSWERED",
	"CREATED",
	"EDITED",
	"DELETED",
	"VERIFIED",
	"REJECTED",
	"AUTO_VERIFIED",
	"SETTLED",
	"PERIOD_CLOSED",
	"PERIOD_REOPENED",
	"PARTICIPANT_ADDED",
	"PARTICIPANT_REMOVED",
	"ROLE_CHANGED",
] as const;

export const auditActionSchema = z
	.enum(AUDIT_ACTIONS)
	.meta({ id: "AuditAction" });

/**
 * The words of an activity entry are written by the server in English from
 * what happened: `summary` for a client that does not translate, and
 * `summaryKey` with `summaryParams` for one that does. Amounts inside the
 * text are already formatted; the figures themselves are in the routes for
 * expenses and payments.
 */
const actorSchema = z.object({
	name: z.string(),
	type: z.enum(["user", "guest", "system", "unknown"]),
	id: z.string().nullable(),
});

const actionSchema = z.object({
	/** The AuditAction in lower case, for example `edited`. */
	type: z.string(),
	label: z.string(),
});

const fieldChangeSchema = z.object({
	field: z.string(),
	label: z.string(),
	oldValue: z.string(),
	newValue: z.string(),
});

const snapshotSchema = z.object({
	amount: z.string(),
	currency: z.string(),
	description: z.string(),
	category: z.string().nullable(),
	date: z.string(),
	splitMode: z.string(),
	paidBy: z.string(),
	participants: z.array(z.object({ name: z.string(), share: z.string() })),
});

export const activityDetailSchema = z
	.discriminatedUnion("type", [
		z.object({
			type: z.literal("field_changes"),
			changes: z.array(fieldChangeSchema),
		}),
		z.object({
			type: z.literal("creation_snapshot"),
			snapshot: snapshotSchema,
		}),
		z.object({
			type: z.literal("deletion_snapshot"),
			snapshot: snapshotSchema,
		}),
		z.object({ type: z.literal("rejection"), reason: z.string().nullable() }),
		z.object({ type: z.literal("verification"), note: z.string().nullable() }),
	])
	.meta({ id: "ActivityDetail" });

export const activityEntrySchema = z
	.object({
		id: idSchema,
		timestamp: timestampSchema,
		actor: actorSchema.extend({ avatarUrl: z.string().nullable() }),
		action: actionSchema,
		summary: z.string(),
		summaryKey: z.string().nullable(),
		summaryParams: z.record(z.string(), z.string()).nullable(),
		target: z.object({
			type: z.string(),
			id: z.string(),
			label: z.string().nullable(),
		}),
		detail: activityDetailSchema.nullable(),
	})
	.meta({ id: "ActivityEntry" });

export const activityQuerySchema = z
	.object({
		id: idSchema,
		cursor: z.string().min(1).max(512).optional(),
		limit: z.coerce.number().int().min(1).max(100).default(50),
		actions: z.string().max(400).optional().meta({
			description: "Comma-separated AuditAction values to keep.",
			examples: ["CREATED,EDITED"],
		}),
		actorType: participantTypeSchema.optional(),
		actorId: idSchema.optional().meta({
			description: "With actorType: only what that person did.",
		}),
	})
	.meta({ id: "ActivityQuery" });

export const projectActivityPageSchema = z
	.object({
		items: z.array(activityEntrySchema),
		nextCursor: z.string().nullable(),
		/** All entries matching the filters, not only this page. */
		totalCount: z.int().min(0),
	})
	.meta({ id: "ProjectActivityPage" });

export const activityFiltersSchema = z
	.object({
		actors: z.array(
			z.object({
				type: z.string(),
				id: z.string(),
				name: z.string(),
				avatarUrl: z.string().nullable(),
			}),
		),
		actionTypes: z.array(
			z.object({
				value: auditActionSchema,
				label: z.string(),
				count: z.int().min(0),
			}),
		),
	})
	.meta({ id: "ActivityFilters" });

export const lastActivityQuerySchema = z.object({
	ids: z.string().min(1).max(40_000).meta({
		description: "Comma-separated project ids, at most 500.",
	}),
});

export const MAX_LAST_ACTIVITY_IDS = 500;

export const expenseHistorySchema = z
	.object({
		expense: z.object({
			id: idSchema,
			title: z.string(),
			/** Null once the expense is deleted. */
			amount: moneySchema.nullable(),
			currency: z.string(),
			isDeleted: z.boolean(),
			isLocked: z.boolean(),
		}),
		entries: z.array(
			z.object({
				id: idSchema,
				timestamp: timestampSchema,
				actor: actorSchema,
				action: actionSchema,
				summary: z.string(),
				detail: activityDetailSchema.nullable(),
			}),
		),
		totalEntries: z.int().min(0),
	})
	.meta({ id: "ExpenseHistory" });

export const revisionsQuerySchema = z.object({
	ids: z.string().min(1).max(8000).meta({
		description: "Comma-separated expense ids, at most 100.",
	}),
});

export const MAX_REVISION_IDS = 100;

export const revisionSummarySchema = z
	.object({
		items: z.array(
			z.object({
				expenseId: idSchema,
				editCount: z.int().min(1),
				lastEditedAt: timestampSchema.nullable(),
				lastEditedBy: z.string().nullable(),
			}),
		),
	})
	.meta({ id: "RevisionSummary" });

/**
 * What happened in a project and to an expense: the feed with its filters,
 * the latest entry per project, an expense's revision history and its edit
 * counts. Reading an expense's history marks its changes as seen, like the
 * web; POST .../seen does it without reading.
 */
export const activityContract = {
	feed: v1
		.route({
			method: "GET",
			path: "/projects/{id}/activity",
			operationId: "listProjectActivity",
			tags: TAG,
			summary: "A project's activity, newest first",
			description: "Any member can read it.",
		})
		.meta({ scope: "read" })
		.input(activityQuerySchema)
		.output(projectActivityPageSchema),
	filters: v1
		.route({
			method: "GET",
			path: "/projects/{id}/activity/filters",
			operationId: "getProjectActivityFilters",
			tags: TAG,
			summary: "Who acted and what kinds of change a project's feed has",
		})
		.meta({ scope: "read" })
		.input(z.object({ id: idSchema }))
		.output(activityFiltersSchema),
	lastActivity: v1
		.route({
			method: "GET",
			path: "/projects/last-activity",
			operationId: "getProjectsLastActivity",
			tags: TAG,
			summary: "The latest entry of each project, for the projects list",
			description: "Projects you are not in are left out.",
		})
		.meta({ scope: "read" })
		.input(lastActivityQuerySchema)
		.output(
			z.object({
				items: z.array(
					z.object({ projectId: idSchema, entry: activityEntrySchema }),
				),
			}),
		),
	history: v1
		.route({
			method: "GET",
			path: "/shared-expenses/{id}/history",
			operationId: "getSharedExpenseHistory",
			tags: TAG,
			summary: "Every revision of a split expense, oldest first",
			description:
				"For people on it and members of its project. Still readable after it was deleted. Marks its changes as seen for you.",
		})
		.meta({ scope: "read" })
		.input(z.object({ id: idSchema }))
		.output(expenseHistorySchema),
	revisions: v1
		.route({
			method: "GET",
			path: "/shared-expenses/revisions",
			operationId: "getSharedExpenseRevisions",
			tags: TAG,
			summary: "How often split expenses were edited, and by whom last",
			description: "Expenses never edited are left out.",
		})
		.meta({ scope: "read" })
		.input(revisionsQuerySchema)
		.output(revisionSummarySchema),
	markSeen: v1
		.route({
			method: "POST",
			path: "/shared-expenses/{id}/seen",
			operationId: "markSharedExpenseSeen",
			tags: TAG,
			summary: "Mark the changes to a split expense as seen",
			description: "Does nothing when there is nothing unseen.",
		})
		.meta({ scope: "write:settings", event: "shared_expense.seen" })
		.input(z.object({ id: idSchema }))
		.output(okSchema),
};
