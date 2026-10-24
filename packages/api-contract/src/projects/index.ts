import * as z from "zod";
import { v1 } from "../common/meta";
import { currencyCodeSchema, moneySchema } from "../common/money";
import { pageOf } from "../common/pagination";
import { undoTokenSchema } from "../common/preview";
import { idSchema } from "../core";
import { daySchema, previewTwin, undoField, undoInputSchema } from "../ledger";
import { participantTypeSchema } from "../people/schemas";

const TAG = ["Projects"];

export const PROJECT_ROLES = [
	"ORGANIZER",
	"EDITOR",
	"CONTRIBUTOR",
	"VIEWER",
] as const;

export const projectRoleSchema = z
	.enum(PROJECT_ROLES)
	.meta({ id: "ProjectRole" });

export const projectIdParamsSchema = z.object({ id: idSchema });

const faceSchema = z.object({
	/** `<type>:<id>`. */
	id: z.string(),
	name: z.string(),
	imageUrl: z.string().nullable(),
});

export const projectBudgetSchema = z
	.object({
		amount: moneySchema,
		/** Spent in the budget's own currency; other currencies are left out, never converted. */
		spent: moneySchema,
		/** Negative when over. */
		left: moneySchema,
		/** Spent over budget in hundredths of a percent, capped at 10000 for the bar. */
		used: z.int().min(0).max(10_000),
		over: z.boolean(),
	})
	.meta({ id: "ProjectBudget" });

export const projectListItemSchema = z
	.object({
		id: idSchema,
		name: z.string(),
		imageUrl: z.string().nullable(),
		status: z.enum(["ACTIVE", "ARCHIVED"]),
		/** The project's own currency, the one a row shows first. */
		currency: z.string(),
		myRole: projectRoleSchema.nullable(),
		/** Nobody else is in it. */
		solo: z.boolean(),
		/** The other members, in join order. */
		people: z.array(faceSchema),
		/** Everyone, you included. */
		peopleCount: z.int().min(0),
		expenseCount: z.int().min(0),
		firstExpense: daySchema.nullable(),
		lastExpense: daySchema.nullable(),
		/** The year an archived project is listed under. */
		year: z.int(),
		/** Every expense, per currency. */
		total: z.array(moneySchema),
		/** Your shares. */
		myShare: z.array(moneySchema),
		/** Paid - Share - Received + Sent for you: positive, the group owes you. */
		myBalance: z.array(moneySchema),
		budget: projectBudgetSchema.nullable(),
	})
	.meta({ id: "ProjectListItem" });

const projectExpenseRowSchema = z
	.object({
		id: idSchema,
		title: z.string(),
		date: daySchema,
		category: z
			.object({
				id: idSchema,
				name: z.string(),
				icon: z.string().nullable(),
				color: z.string(),
			})
			.nullable(),
		amount: moneySchema,
		/** Your share, in the expense's currency; null when you are not in it. */
		share: moneySchema.nullable(),
		people: z.array(faceSchema),
		payerId: z.string(),
		/** Null when you paid. */
		payerName: z.string().nullable(),
		payerIsMe: z.boolean(),
		waiting: z.enum(["review", "rejected"]).nullable(),
		mine: z.boolean(),
		locked: z.boolean(),
	})
	.meta({ id: "ProjectExpenseRow" });

export const projectMemberSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		imageUrl: z.string().nullable(),
		participantType: participantTypeSchema,
		participantId: idSchema,
		isMe: z.boolean(),
		role: projectRoleSchema,
		onRetrospend: z.boolean(),
		joinedOn: daySchema.nullable(),
		leftOn: daySchema.nullable(),
		/** Your balance with them in this project; positive, they owe you. */
		withMe: z.array(moneySchema),
	})
	.meta({ id: "ProjectPageMember" });

export const projectPageSchema = z
	.object({
		id: idSchema,
		name: z.string(),
		description: z.string().nullable(),
		imageUrl: z.string().nullable(),
		status: z.enum(["ACTIVE", "ARCHIVED"]),
		visibility: z.enum(["PRIVATE", "PUBLIC"]),
		primaryCurrency: z.string(),
		autoAcceptSplits: z.boolean(),
		billingCycleLength: z
			.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "CUSTOM"])
			.nullable(),
		myRole: projectRoleSchema.nullable(),
		excludeFromAnalytics: z.boolean(),
		solo: z.boolean(),
		/** Today in your time zone. */
		today: daySchema,
		/** All expenses; `expenses` holds the newest 500. */
		expenseCount: z.int().min(0),
		firstExpense: daySchema.nullable(),
		lastExpense: daySchema.nullable(),
		total: z.array(moneySchema),
		myShare: z.array(moneySchema),
		budget: projectBudgetSchema.nullable(),
		/** Everyone, you first, then in join order. */
		members: z.array(projectMemberSchema),
		byCategory: z.array(
			z.object({
				id: idSchema.nullable(),
				name: z.string().nullable(),
				icon: z.string().nullable(),
				color: z.string().nullable(),
				group: z.array(moneySchema),
				mine: z.array(moneySchema),
			}),
		),
		payments: z.array(
			z.object({
				id: idSchema,
				from: faceSchema,
				to: faceSchema,
				amount: moneySchema,
				date: daySchema,
				pending: z.boolean(),
			}),
		),
		openPeriod: idSchema.nullable(),
		expenses: z.array(projectExpenseRowSchema),
	})
	.meta({ id: "ProjectPage" });

export const projectMembersQuerySchema = projectIdParamsSchema.extend({
	date: daySchema.optional().meta({
		description: "Who was a member on this day. Today when omitted.",
	}),
});

export const projectMemberOnSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		imageUrl: z.string().nullable(),
		participantType: participantTypeSchema,
		participantId: idSchema,
		role: projectRoleSchema,
		joinedOn: daySchema.nullable(),
		leftOn: daySchema.nullable(),
	})
	.meta({ id: "ProjectMember" });

export const projectSummaryQuerySchema = projectIdParamsSchema.extend({
	periodId: idSchema.optional().meta({
		description: "One billing period instead of the whole project.",
	}),
});

const summaryPersonSchema = z.object({
	type: participantTypeSchema,
	id: idSchema,
	key: z.string(),
	name: z.string(),
	imageUrl: z.string().nullable(),
});

export const projectSummarySchema = z
	.object({
		projectId: idSchema,
		periodId: idSchema.nullable(),
		total: z.array(moneySchema),
		/** True when the balances add up to zero in every currency. */
		balancesAddUp: z.boolean(),
		/** Currencies whose balances do not add up, with the sum. */
		imbalance: z.array(moneySchema),
		members: z.array(
			summaryPersonSchema.extend({
				/** False for someone on the ledger who is no longer in the project. */
				isMember: z.boolean(),
				role: projectRoleSchema.nullable(),
				joinedOn: daySchema.nullable(),
				leftOn: daySchema.nullable(),
				lines: z.array(
					z.object({
						currency: currencyCodeSchema,
						paid: moneySchema,
						share: moneySchema,
						received: moneySchema,
						sent: moneySchema,
						/** Paid - Share - Received + Sent: positive, the group owes them. */
						balance: moneySchema,
					}),
				),
			}),
		),
		/** The fewest transfers that settle the group, per currency. Display only. */
		transfers: z.array(
			z.object({
				from: summaryPersonSchema,
				to: summaryPersonSchema,
				amount: moneySchema,
			}),
		),
	})
	.meta({ id: "ProjectSummary" });

// ── Settle all ──────────────────────────────────────────────────────────────

/** One open balance in the project; positive `minor` means they owe you. */
export const plannedLineSchema = z
	.object({
		/** `<type>:<id>`. */
		person: z.string().min(1),
		currency: currencyCodeSchema,
		minor: z.int(),
	})
	.meta({ id: "SettleAllLine" });

export const skippedLineSchema = z
	.object({
		person: z.string(),
		direction: z.enum(["outgoing", "incoming"]),
		amount: moneySchema,
		reason: z.enum(["matches_claim", "overpay", "nothing_owed"]),
	})
	.meta({ id: "SettleAllSkipped" });

export const settleAllPlanSchema = z
	.object({
		/** Send these back as `expect` to record exactly what you saw. */
		planned: z.array(plannedLineSchema),
		/** Lines recording would leave for the person to handle. */
		skipped: z.array(skippedLineSchema),
	})
	.meta({ id: "SettleAllPlan" });

export const settleAllSchema = z
	.object({
		id: idSchema,
		expect: z.array(plannedLineSchema).max(200).optional().meta({
			description:
				"The planned lines you were shown. Refused with a conflict when the balances moved since. Left out: records what is open now.",
		}),
	})
	.meta({ id: "SettleAll" });

export const settleAllResultSchema = z
	.object({
		settled: z.array(
			z.object({
				person: z.string(),
				direction: z.enum(["outgoing", "incoming"]),
				amount: moneySchema,
				paymentId: idSchema,
				status: z.enum(["PROPOSED", "FINALIZED"]),
			}),
		),
		skipped: z.array(skippedLineSchema),
		...undoField,
	})
	.meta({ id: "SettleAllResult" });

export const settleAllUndoInputSchema = projectIdParamsSchema
	.extend(undoInputSchema.shape)
	.meta({ id: "SettleAllUndoInput" });

export const settleAllUndoResultSchema = z
	.object({
		undone: z.int().min(0),
		/** Always null: taking back a settle all has no redo. */
		redo: undoTokenSchema.nullable(),
	})
	.meta({ id: "SettleAllUndo" });

/**
 * Projects you are a member of. The page, the summary and the members come
 * from the same reads as the web, so they agree with it. Writes that change
 * a project itself (create, roles, links, periods) are not in v1 yet.
 */
export const projectsContract = {
	list: v1
		.route({
			method: "GET",
			path: "/projects",
			operationId: "listProjects",
			tags: TAG,
			summary: "Your projects with their figures",
			description: "All of them, newest change first; there is no next page.",
		})
		.meta({ scope: "read" })
		.output(pageOf(projectListItemSchema)),
	get: v1
		.route({
			method: "GET",
			path: "/projects/{id}",
			operationId: "getProject",
			tags: TAG,
			summary:
				"The project page: header, people, categories, payments and expenses",
		})
		.meta({ scope: "read" })
		.input(projectIdParamsSchema)
		.output(projectPageSchema),
	members: v1
		.route({
			method: "GET",
			path: "/projects/{id}/members",
			operationId: "listProjectMembers",
			tags: TAG,
			summary: "Who was a member on a day",
			description:
				"What a new expense on that day includes by default. Joining and leaving never change a split already saved.",
		})
		.meta({ scope: "read" })
		.input(projectMembersQuerySchema)
		.output(z.object({ items: z.array(projectMemberOnSchema) })),
	summary: v1
		.route({
			method: "GET",
			path: "/projects/{id}/summary",
			operationId: "getProjectSummary",
			tags: TAG,
			summary:
				"Paid, Share, Received, Sent and Balance per member and currency",
		})
		.meta({ scope: "read" })
		.input(projectSummaryQuerySchema)
		.output(projectSummarySchema),
	settleAllPlan: v1
		.route({
			method: "GET",
			path: "/projects/{id}/settle-all/plan",
			operationId: "getSettleAllPlan",
			tags: TAG,
			summary: "The payments Settle all would record",
			description:
				"Runs the write and rolls it back. Needs the Contributor role or more, like the write.",
		})
		.meta({ scope: "read" })
		.input(projectIdParamsSchema)
		.output(settleAllPlanSchema),
	settleAll: v1
		.route({
			method: "POST",
			path: "/projects/{id}/settle-all",
			operationId: "settleAllInProject",
			tags: TAG,
			summary: "Settle every balance you have with the others in a project",
			description:
				"One payment per person and currency, never converted. Someone who owes you is recorded as having paid you; a payment to someone on Retrospend waits for them to confirm.",
			successStatus: 201,
		})
		.meta({ scope: "write:money", event: "project.settled_all" })
		.input(settleAllSchema)
		.output(settleAllResultSchema),
	previewSettleAll: previewTwin({
		path: "/projects/{id}/settle-all",
		of: "POST /projects/{id}/settle-all",
		operationId: "previewSettleAllInProject",
		tags: TAG,
		scope: "write:money",
		input: settleAllSchema,
	}),
	undoSettleAll: v1
		.route({
			method: "POST",
			path: "/projects/{id}/settle-all/undo",
			operationId: "undoSettleAll",
			tags: TAG,
			summary: "Take back the payments one Settle all wrote",
			description:
				"All or none. A conflict when one of them was confirmed meanwhile.",
		})
		.meta({ scope: "write:money", event: "project.settle_all_undone" })
		.input(settleAllUndoInputSchema)
		.output(settleAllUndoResultSchema),
	previewUndoSettleAll: previewTwin({
		path: "/projects/{id}/settle-all/undo",
		of: "POST /projects/{id}/settle-all/undo",
		operationId: "previewUndoSettleAll",
		tags: TAG,
		scope: "write:money",
		input: settleAllUndoInputSchema,
	}),
};
