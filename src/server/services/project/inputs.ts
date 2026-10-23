/**
 * Input schemas of the project procedures, one per procedure. They move to
 * packages/api-contract with /api/v1 (IMPLEMENTATION §2.2), so tRPC and v1
 * validate the same shapes.
 */
import { z } from "zod";
import { isIsoDate } from "./membership";

const id = z.string().min(1);
const role = z.enum(["ORGANIZER", "EDITOR", "CONTRIBUTOR", "VIEWER"]);
const cycleLength = z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "CUSTOM"]);
const closePermission = z.enum(["ORGANIZER_ONLY", "ANY_PARTICIPANT"]);
const participantType = z.enum(["user", "guest", "shadow"]);

/** A calendar day, YYYY-MM-DD, as the client's local date. */
const isoDate = z
	.string()
	.refine(isIsoDate, { message: "Expected a calendar day (YYYY-MM-DD)" });

const member = z.object({
	projectId: id,
	participantType,
	participantId: id,
});

const page = {
	page: z.number().int().positive().default(1),
	limit: z.number().int().positive().max(500).default(20),
};

const group = z.object({ projectId: id, periodId: z.string().optional() });

export const projectInput = {
	create: z.object({
		name: z.string().min(1).max(191),
		description: z.string().max(500).optional(),
		budgetAmount: z.number().positive().optional(),
		budgetCurrency: z.string().min(1).max(10).optional(),
		primaryCurrency: z.string().min(1).max(10).default("USD"),
		visibility: z.enum(["PRIVATE", "PUBLIC"]).default("PRIVATE"),
		billingCycleLength: cycleLength.optional(),
		billingCycleDays: z.number().int().positive().optional(),
		billingAutoClose: z.boolean().default(false),
		billingCloseReminderDays: z.number().int().min(0).default(3),
		billingClosePermission: closePermission.default("ORGANIZER_ONLY"),
	}),
	list: z.object({ status: z.enum(["ACTIVE", "ARCHIVED"]).optional() }),
	byId: z.object({ id }),
	analyticsExclusion: z.object({ projectId: id, exclude: z.boolean() }),
	update: z.object({
		id,
		name: z.string().min(1).max(191).optional(),
		description: z.string().max(500).nullish(),
		budgetAmount: z.number().positive().nullish(),
		budgetCurrency: z.string().min(1).max(10).nullish(),
		primaryCurrency: z.string().min(1).max(10).optional(),
		status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
		visibility: z.enum(["PRIVATE", "PUBLIC"]).optional(),
		billingCycleLength: cycleLength.nullish(),
		billingCycleDays: z.number().int().positive().nullish(),
		billingAutoClose: z.boolean().optional(),
		billingCloseReminderDays: z.number().int().min(0).optional(),
		billingClosePermission: closePermission.optional(),
		autoAcceptSplits: z.boolean().optional(),
	}),
	member,
	addParticipant: member.extend({
		role: role.default("CONTRIBUTOR"),
		joinedOn: isoDate.optional(),
	}),
	rebalance: member.extend({ expenseIds: z.array(id).optional() }),
	role: member.extend({ role }),
	transferOwnership: z.object({
		projectId: id,
		newOwnerParticipantId: id,
		confirmProjectName: id,
	}),
	membersOn: z.object({ projectId: id, date: isoDate.optional() }),
	membershipDates: member.extend({
		joinedOn: isoDate.nullish(),
		leftOn: isoDate.nullish(),
	}),
	listExpenses: z.object({
		projectId: id,
		billingPeriodId: z.string().optional(),
		...page,
	}),
	publicListExpenses: z.object({ projectId: id, ...page }),
	createMagicLink: z.object({
		projectId: id,
		roleGranted: role.default("CONTRIBUTOR"),
		expiresAt: z.date().optional(),
		maxUses: z.number().int().positive().optional(),
	}),
	project: z.object({ projectId: id }),
	revokeMagicLink: z.object({ projectId: id, linkId: id }),
	resetMagicLink: z.object({ projectId: id, role }),
	group,
	perspective: z.object({
		projectId: id,
		perspective: z.object({ participantType, participantId: id }),
	}),
};
