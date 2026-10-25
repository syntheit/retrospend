import * as z from "zod";
import { v1 } from "../common/meta";
import { currencyCodeSchema, moneySchema } from "../common/money";
import { pageOf } from "../common/pagination";
import { userText } from "../common/user-text";
import { idSchema, okSchema, timestampSchema } from "../core";
import { amountTextSchema, daySchema, previewTwin } from "../ledger";
import { participantTypeSchema, personRefSchema } from "../people/schemas";
import { projectRoleSchema } from "./roles";

const TAG = ["Projects"];

const SCOPE = "write:expenses" as const;

export const BILLING_CYCLES = ["WEEKLY", "BIWEEKLY", "MONTHLY", "CUSTOM"] as const;
export const billingCycleSchema = z
	.enum(BILLING_CYCLES)
	.meta({ id: "BillingCycleLength" });

export const closePermissionSchema = z
	.enum(["ORGANIZER_ONLY", "ANY_PARTICIPANT"])
	.meta({ id: "BillingClosePermission" });

const visibilitySchema = z
	.enum(["PRIVATE", "PUBLIC"])
	.meta({ id: "ProjectVisibility" });

const roleSchema = projectRoleSchema;

// ── The project itself ──────────────────────────────────────────────────────

export const projectSettingsSchema = z
	.object({
		id: idSchema,
		name: z.string(),
		description: z.string().nullable(),
		status: z.enum(["ACTIVE", "ARCHIVED"]),
		/** PUBLIC shows a read-only page to anyone with the link. */
		visibility: visibilitySchema,
		primaryCurrency: z.string(),
		budget: moneySchema.nullable(),
		billingCycleLength: billingCycleSchema.nullable(),
		billingCycleDays: z.int().positive().nullable(),
		billingAutoClose: z.boolean(),
		billingCloseReminderDays: z.int().min(0),
		billingClosePermission: closePermissionSchema,
		/** Shares added to a split in this project count as accepted. */
		autoAcceptSplits: z.boolean(),
		createdAt: timestampSchema,
		updatedAt: timestampSchema,
	})
	.meta({ id: "ProjectSettings" });

const nameSchema = userText("project.name", 191);
const descriptionSchema = userText("project.description", 500);

export const createProjectSchema = z
	.object({
		id: z.uuid().optional().meta({
			description:
				"A client-made id. Sending the same id twice is a conflict, not a second project.",
		}),
		name: nameSchema,
		description: descriptionSchema.optional(),
		budgetAmount: amountTextSchema.optional(),
		budgetCurrency: currencyCodeSchema.optional(),
		primaryCurrency: currencyCodeSchema.default("USD"),
		visibility: visibilitySchema.default("PRIVATE"),
		billingCycleLength: billingCycleSchema.optional(),
		billingCycleDays: z.int().positive().optional(),
		billingAutoClose: z.boolean().default(false),
		billingCloseReminderDays: z.int().min(0).default(3),
		billingClosePermission: closePermissionSchema.default("ORGANIZER_ONLY"),
	})
	.meta({ id: "CreateProject" });

/** Fields left out stay as they are; null clears the ones that can be cleared. */
export const updateProjectSchema = z
	.object({
		id: idSchema,
		name: nameSchema.optional(),
		description: descriptionSchema.nullish(),
		budgetAmount: amountTextSchema.nullish(),
		budgetCurrency: currencyCodeSchema.nullish(),
		primaryCurrency: currencyCodeSchema.optional(),
		status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
		visibility: visibilitySchema.optional(),
		billingCycleLength: billingCycleSchema.nullish(),
		billingCycleDays: z.int().positive().nullish(),
		billingAutoClose: z.boolean().optional(),
		billingCloseReminderDays: z.int().min(0).optional(),
		billingClosePermission: closePermissionSchema.optional(),
		autoAcceptSplits: z.boolean().optional(),
	})
	.meta({ id: "UpdateProject" });

export const analyticsExclusionSchema = z
	.object({ id: idSchema, exclude: z.boolean() })
	.meta({ id: "ProjectAnalyticsExclusion" });

// ── Members ─────────────────────────────────────────────────────────────────

export const memberParamsSchema = z.object({
	id: idSchema,
	type: participantTypeSchema,
	personId: idSchema,
});

export const memberRowSchema = z
	.object({
		person: personRefSchema,
		role: roleSchema,
		joinedOn: daySchema.nullable(),
		leftOn: daySchema.nullable(),
	})
	.meta({ id: "ProjectMemberRow" });

export const addMemberSchema = z
	.object({
		id: idSchema,
		person: personRefSchema,
		role: roleSchema.default("CONTRIBUTOR"),
		joinedOn: daySchema.optional().meta({
			description: "When they join. Left out: the project's default.",
		}),
	})
	.meta({ id: "AddProjectMember" });

export const memberRoleSchema = memberParamsSchema
	.extend({ role: roleSchema })
	.meta({ id: "SetProjectMemberRole" });

export const memberDatesSchema = memberParamsSchema
	.extend({
		joinedOn: daySchema.nullish().meta({
			description: "Left out: kept. Null: from the start.",
		}),
		leftOn: daySchema.nullish().meta({
			description: "Left out: kept. Null: still a member.",
		}),
	})
	.meta({ id: "SetProjectMemberDates" });

export const transferOwnershipSchema = z
	.object({
		id: idSchema,
		newOwnerId: idSchema.meta({
			description: "The user id of a member who becomes the owner.",
		}),
		confirmProjectName: z.string().min(1).max(191).meta({
			description: "The project's name, typed again to confirm.",
		}),
	})
	.meta({ id: "TransferProjectOwnership" });

// ── Rebalance ───────────────────────────────────────────────────────────────

export const rebalanceQuerySchema = z.object({
	id: idSchema,
	type: participantTypeSchema,
	personId: idSchema,
});

export const rebalanceableSchema = z
	.object({
		id: idSchema,
		title: z.string(),
		amount: moneySchema,
		date: daySchema,
		splitMode: z.enum(["EQUAL", "EXACT", "PERCENTAGE", "SHARES"]),
		/** Only equal splits can be recomputed. */
		eligible: z.boolean(),
		currentParticipantCount: z.int().min(0),
		/** Dated before the person joined: never preselected. */
		beforeJoin: z.boolean(),
		/** It already has every other member. */
		hasAllOtherMembers: z.boolean(),
	})
	.meta({ id: "RebalanceableExpense" });

export const rebalanceSchema = z
	.object({
		id: idSchema,
		person: personRefSchema,
		expenseIds: z.array(idSchema).max(500).optional().meta({
			description: "Left out: every eligible expense.",
		}),
	})
	.meta({ id: "RebalanceExpenses" });

export const rebalanceResultSchema = z
	.object({
		rebalancedCount: z.int().min(0),
		rebalancedIds: z.array(idSchema),
		skipped: z.array(
			z.object({
				id: idSchema,
				reason: z.enum([
					"locked",
					"already_included",
					"non_equal_split",
					"before_join",
				]),
			}),
		),
	})
	.meta({ id: "RebalanceResult" });

// ── Magic links ─────────────────────────────────────────────────────────────

export const magicLinkSchema = z
	.object({
		id: idSchema,
		roleGranted: roleSchema,
		/** The invite link itself; whoever has it joins with that role. */
		url: z.string(),
		isActive: z.boolean(),
		expiresAt: timestampSchema.nullable(),
		maxUses: z.int().positive().nullable(),
		useCount: z.int().min(0),
		createdAt: timestampSchema,
	})
	.meta({ id: "MagicLink" });

export const createMagicLinkSchema = z
	.object({
		id: idSchema,
		roleGranted: roleSchema
			.exclude(["ORGANIZER"])
			.default("CONTRIBUTOR")
			.meta({ description: "Never Owner." }),
		expiresAt: timestampSchema.optional(),
		maxUses: z.int().positive().optional(),
	})
	.meta({ id: "CreateMagicLink" });

export const resetMagicLinkSchema = z
	.object({ id: idSchema, role: roleSchema.exclude(["ORGANIZER"]) })
	.meta({ id: "ResetMagicLink" });

export const magicLinkParamsSchema = z.object({
	id: idSchema,
	linkId: idSchema,
});

// ── Expenses of a project ───────────────────────────────────────────────────

export const projectExpensesQuerySchema = z
	.object({
		id: idSchema,
		billingPeriodId: idSchema.optional(),
		cursor: z.string().min(1).max(512).optional(),
		limit: z.coerce.number().int().min(1).max(200).default(50),
	})
	.meta({ id: "ProjectExpensesQuery" });

const rowPersonSchema = z.object({
	type: participantTypeSchema,
	id: idSchema,
	name: z.string(),
	imageUrl: z.string().nullable(),
});

export const projectExpenseListRowSchema = z
	.object({
		id: idSchema,
		title: z.string(),
		date: daySchema,
		amount: moneySchema,
		category: z
			.object({
				id: idSchema,
				name: z.string(),
				color: z.string(),
				icon: z.string().nullable(),
			})
			.nullable(),
		splitMode: z.enum(["EQUAL", "EXACT", "PERCENTAGE", "SHARES"]),
		locked: z.boolean(),
		/** pending: someone has not answered. disputed: someone rejected. active: all accepted. settled: locked by a payment. */
		status: z.enum(["pending", "disputed", "active", "settled"]),
		paidBy: rowPersonSchema.extend({ isMe: z.boolean() }),
		canEdit: z.boolean(),
		hasUnseenChanges: z.boolean(),
		splits: z.array(
			rowPersonSchema.extend({
				share: moneySchema,
				verification: z.enum(["PENDING", "ACCEPTED", "REJECTED", "AUTO_ACCEPTED"]),
			}),
		),
	})
	.meta({ id: "ProjectExpenseListRow" });

export const projectExpensesPageSchema = pageOf(
	projectExpenseListRowSchema,
).extend({ total: z.int().min(0) });

/**
 * Creating and running a project: its settings, members, roles, ownership,
 * invite links and expenses. Roles are the web's: an Editor changes the
 * project and its members, an Owner changes Owners and ownership, and only
 * the person who created it deletes it.
 */
export const projectWritesContract = {
	create: v1
		.route({
			method: "POST",
			path: "/projects",
			operationId: "createProject",
			tags: TAG,
			summary: "Create a project",
			description:
				"You become its Owner. A billing cycle opens the first billing period.",
			successStatus: 201,
		})
		.meta({ scope: SCOPE, event: "project.created" })
		.input(createProjectSchema)
		.output(projectSettingsSchema),
	update: v1
		.route({
			method: "PATCH",
			path: "/projects/{id}",
			operationId: "updateProject",
			tags: TAG,
			summary: "Change a project's settings",
			description:
				"Needs the Editor role. Only the fields sent change. Archiving, restoring and deleting are for Owners.",
		})
		.meta({ scope: SCOPE, event: "project.updated" })
		.input(updateProjectSchema)
		.output(projectSettingsSchema),
	delete: v1
		.route({
			method: "DELETE",
			path: "/projects/{id}",
			operationId: "deleteProject",
			tags: TAG,
			summary: "Delete a project",
			description:
				"Only the person who created it. Its expenses and payments go with it.",
		})
		.meta({ scope: SCOPE, event: "project.deleted" })
		.input(z.object({ id: idSchema }))
		.output(okSchema),
	setAnalyticsExclusion: v1
		.route({
			method: "PUT",
			path: "/projects/{id}/analytics-exclusion",
			operationId: "setProjectAnalyticsExclusion",
			tags: TAG,
			summary: "Leave this project out of your own reports, or put it back",
			description: "Yours alone: other members are not affected.",
		})
		.meta({ scope: "write:settings", event: "project.analytics_exclusion_set" })
		.input(analyticsExclusionSchema)
		.output(z.object({ exclude: z.boolean() })),
	addMember: v1
		.route({
			method: "POST",
			path: "/projects/{id}/members",
			operationId: "addProjectMember",
			tags: TAG,
			summary: "Add someone to a project",
			description:
				"A user on Retrospend is told. A person you added by name gets an invite email when they have an address. Ghosts never hold Editor or Owner. Only an Owner adds an Owner.",
			successStatus: 201,
		})
		.meta({ scope: SCOPE, event: "project.member_added" })
		.input(addMemberSchema)
		.output(memberRowSchema),
	setMemberRole: v1
		.route({
			method: "PUT",
			path: "/projects/{id}/members/{type}/{personId}/role",
			operationId: "setProjectMemberRole",
			tags: TAG,
			summary: "Change a member's role",
			description:
				"Not your own. Only an Owner changes an Owner. The person who created the project stays an Owner.",
		})
		.meta({ scope: SCOPE, event: "project.member_role_set" })
		.input(memberRoleSchema)
		.output(memberRowSchema),
	setMemberDates: v1
		.route({
			method: "PUT",
			path: "/projects/{id}/members/{type}/{personId}/dates",
			operationId: "setProjectMemberDates",
			tags: TAG,
			summary: "Set when someone joined or left",
			description:
				"The dates only choose who a new expense includes by default. A split already saved never changes.",
		})
		.meta({ scope: SCOPE, event: "project.member_dates_set" })
		.input(memberDatesSchema)
		.output(memberRowSchema),
	previewSetMemberDates: previewTwin({
		path: "/projects/{id}/members/{type}/{personId}/dates",
		of: "PUT /projects/{id}/members/{type}/{personId}/dates",
		operationId: "previewSetProjectMemberDates",
		tags: TAG,
		scope: SCOPE,
		input: memberDatesSchema,
	}),
	removeMember: v1
		.route({
			method: "DELETE",
			path: "/projects/{id}/members/{type}/{personId}",
			operationId: "removeProjectMember",
			tags: TAG,
			summary: "Remove someone from a project",
			description:
				"Not the person who created it. Only an Owner removes an Owner. Their past expenses stay.",
		})
		.meta({ scope: SCOPE, event: "project.member_removed" })
		.input(memberParamsSchema)
		.output(okSchema),
	transferOwnership: v1
		.route({
			method: "POST",
			path: "/projects/{id}/ownership",
			operationId: "transferProjectOwnership",
			tags: TAG,
			summary: "Hand the project to another member",
			description:
				"Only the person who created it. You become an Editor. The name is typed again to confirm.",
		})
		.meta({ scope: SCOPE, event: "project.ownership_transferred" })
		.input(transferOwnershipSchema)
		.output(okSchema),
	rebalanceable: v1
		.route({
			method: "GET",
			path: "/projects/{id}/rebalance",
			operationId: "listRebalanceableExpenses",
			tags: TAG,
			summary: "Past expenses a new member could be included in",
			description:
				"Leaves out settled expenses and the ones they are already in. Needs the Editor role.",
		})
		.meta({ scope: "read" })
		.input(rebalanceQuerySchema)
		.output(z.object({ items: z.array(rebalanceableSchema) })),
	rebalance: v1
		.route({
			method: "POST",
			path: "/projects/{id}/rebalance",
			operationId: "rebalanceProjectExpenses",
			tags: TAG,
			summary: "Include a member in past equal-split expenses",
			description:
				"Recomputes the equal shares with the new member. Other split modes and settled expenses are skipped and listed. The people on them verify again unless the project accepts splits by itself. There is no undo: preview first.",
		})
		.meta({ scope: "write:money", event: "project.rebalanced" })
		.input(rebalanceSchema)
		.output(rebalanceResultSchema),
	previewRebalance: previewTwin({
		path: "/projects/{id}/rebalance",
		of: "POST /projects/{id}/rebalance",
		operationId: "previewRebalanceProjectExpenses",
		tags: TAG,
		scope: "write:money",
		input: rebalanceSchema,
	}),
	magicLinks: v1
		.route({
			method: "GET",
			path: "/projects/{id}/magic-links",
			operationId: "listMagicLinks",
			tags: TAG,
			summary: "The active invite links of a project",
			description:
				"Each link is a secret that lets whoever holds it join with its role, so listing needs the write:expenses scope, like creating one. Needs the Editor role.",
		})
		.meta({ scope: SCOPE })
		.input(z.object({ id: idSchema }))
		.output(z.object({ items: z.array(magicLinkSchema) })),
	createMagicLink: v1
		.route({
			method: "POST",
			path: "/projects/{id}/magic-links",
			operationId: "createMagicLink",
			tags: TAG,
			summary: "Make an invite link, or get the active one for that role",
			description:
				"One active link per role, never for Owner. The link is not kept in the idempotency store: replaying the key answers that the response is unavailable, so list the links instead.",
			successStatus: 201,
		})
		.meta({ scope: SCOPE, event: "project.magic_link_created", secretResponse: true })
		.input(createMagicLinkSchema)
		.output(magicLinkSchema),
	revokeMagicLink: v1
		.route({
			method: "DELETE",
			path: "/projects/{id}/magic-links/{linkId}",
			operationId: "revokeMagicLink",
			tags: TAG,
			summary: "Turn an invite link off",
		})
		.meta({ scope: SCOPE, event: "project.magic_link_revoked" })
		.input(magicLinkParamsSchema)
		.output(okSchema),
	resetMagicLink: v1
		.route({
			method: "POST",
			path: "/projects/{id}/magic-links/reset",
			operationId: "resetMagicLink",
			tags: TAG,
			summary: "Replace the active invite link of a role with a new one",
			description:
				"Every active link for that role stops working. Like creating one, the response is not kept for replay.",
			successStatus: 201,
		})
		.meta({ scope: SCOPE, event: "project.magic_link_reset", secretResponse: true })
		.input(resetMagicLinkSchema)
		.output(magicLinkSchema),
	expenses: v1
		.route({
			method: "GET",
			path: "/projects/{id}/expenses",
			operationId: "listProjectExpenses",
			tags: TAG,
			summary: "A project's expenses, a page at a time",
			description:
				"Newest first, one billing period when asked. Each row says whether you can edit it and where it stands.",
		})
		.meta({ scope: "read" })
		.input(projectExpensesQuerySchema)
		.output(projectExpensesPageSchema),
};
