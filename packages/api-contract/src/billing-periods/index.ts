import * as z from "zod";
import { v1 } from "../common/meta";
import { moneySchema } from "../common/money";
import { userText } from "../common/user-text";
import { idSchema, timestampSchema } from "../core";
import { personRefSchema } from "../people/schemas";

const TAG = ["Billing periods"];

const SCOPE = "write:expenses" as const;

export const BILLING_PERIOD_STATUSES = [
	"OPEN",
	"CLOSING",
	"SETTLED",
	"ARCHIVED",
] as const;

export const billingPeriodStatusSchema = z
	.enum(BILLING_PERIOD_STATUSES)
	.meta({ id: "BillingPeriodStatus" });

export const billingPeriodSchema = z
	.object({
		id: idSchema,
		label: z.string(),
		startDate: timestampSchema,
		endDate: timestampSchema,
		/** OPEN takes new expenses. CLOSING waits for everyone to verify and pay. SETTLED is locked. */
		status: billingPeriodStatusSchema,
		closedAt: timestampSchema.nullable(),
		settledAt: timestampSchema.nullable(),
	})
	.meta({ id: "BillingPeriod" });

export const billingPeriodListItemSchema = billingPeriodSchema
	.extend({
		expenseCount: z.int().min(0),
		/** Shares nobody has answered yet. */
		unverifiedCount: z.int().min(0),
		/** All shares in the period. */
		shareCount: z.int().min(0),
	})
	.meta({ id: "BillingPeriodListItem" });

export const billingPeriodDetailSchema = billingPeriodSchema
	.extend({
		expenseCount: z.int().min(0),
		/** What was spent, per currency. */
		total: z.array(moneySchema),
		byCategory: z.array(
			z.object({
				categoryId: idSchema,
				name: z.string(),
				color: z.string(),
				total: z.array(moneySchema),
			}),
		),
		/** Each person's shares, per currency. */
		byPerson: z.array(
			z.object({ person: personRefSchema, share: z.array(moneySchema) }),
		),
	})
	.meta({ id: "BillingPeriodDetail" });

export const billingPeriodParamsSchema = z.object({
	id: idSchema,
	periodId: idSchema,
});

export const renameBillingPeriodSchema = billingPeriodParamsSchema
	.extend({ label: userText("billing_period.label", 100) })
	.meta({ id: "RenameBillingPeriod" });

export const closedBillingPeriodSchema = z
	.object({ closed: billingPeriodSchema, next: billingPeriodSchema })
	.meta({ id: "ClosedBillingPeriod" });

/**
 * Billing periods of a project with a billing cycle. Closing the open
 * period starts the next one and tells the members; once everyone verified
 * and every balance is paid, the owner settles it and its expenses lock.
 */
export const billingPeriodsContract = {
	list: v1
		.route({
			method: "GET",
			path: "/projects/{id}/billing-periods",
			operationId: "listBillingPeriods",
			tags: TAG,
			summary: "A project's billing periods, newest first",
			description:
				"A period past its end date closes by itself when the project is set to.",
		})
		.meta({ scope: "read" })
		.input(z.object({ id: idSchema }))
		.output(z.object({ items: z.array(billingPeriodListItemSchema) })),
	get: v1
		.route({
			method: "GET",
			path: "/projects/{id}/billing-periods/{periodId}",
			operationId: "getBillingPeriod",
			tags: TAG,
			summary: "One billing period with its totals",
			description:
				"Its expenses are GET /projects/{id}/expenses?billingPeriodId=.",
		})
		.meta({ scope: "read" })
		.input(billingPeriodParamsSchema)
		.output(billingPeriodDetailSchema),
	closeCurrent: v1
		.route({
			method: "POST",
			path: "/projects/{id}/billing-periods/close",
			operationId: "closeBillingPeriod",
			tags: TAG,
			summary: "Close the open period and start the next one",
			description:
				"Needs the Owner role, or the Contributor role when the project lets any member close. The other members are told.",
		})
		.meta({ scope: SCOPE, event: "billing_period.closed" })
		.input(z.object({ id: idSchema }))
		.output(closedBillingPeriodSchema),
	settle: v1
		.route({
			method: "POST",
			path: "/projects/{id}/billing-periods/{periodId}/settle",
			operationId: "settleBillingPeriod",
			tags: TAG,
			summary: "Mark a closing period settled and lock its expenses",
			description:
				"Needs the Owner role. Refused while a share is unanswered or a balance in the period is still outstanding: record the payments first. There is no undo.",
		})
		.meta({ scope: SCOPE, event: "billing_period.settled" })
		.input(billingPeriodParamsSchema)
		.output(billingPeriodSchema),
	rename: v1
		.route({
			method: "PATCH",
			path: "/projects/{id}/billing-periods/{periodId}",
			operationId: "renameBillingPeriod",
			tags: TAG,
			summary: "Rename a billing period",
			description: "Whoever may close periods may rename them.",
		})
		.meta({ scope: SCOPE, event: "billing_period.renamed" })
		.input(renameBillingPeriodSchema)
		.output(billingPeriodSchema),
};
