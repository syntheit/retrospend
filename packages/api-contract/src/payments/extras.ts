import * as z from "zod";
import { v1 } from "../common/meta";
import { currencyCodeSchema, moneySchema } from "../common/money";
import { idSchema } from "../core";
import { previewTwin, undoField } from "../ledger";
import { personParamsSchema, personRefSchema } from "../people/schemas";

const TAG = ["Payments"];

export const removePaymentSchema = z
	.object({ id: idSchema })
	.meta({ id: "RemovePayment" });

export const paymentRemovedSchema = z
	.object({
		id: idSchema,
		/** delete: it was still waiting for the other person. void: it had become final without their agreement. */
		mode: z.enum(["delete", "void"]),
	})
	.meta({ id: "PaymentRemoved" });

export const squareUpOptionSchema = z
	.object({
		currency: currencyCodeSchema,
		/** What squaring up cancels: the larger side of the offsets. */
		amount: moneySchema,
		scopes: z.array(
			z.object({
				/** Null is Outside projects. */
				project: z.object({ id: idSchema, name: z.string() }).nullable(),
				/** Positive: they owe you there. Negative: you owe them. */
				balance: moneySchema,
			}),
		),
	})
	.meta({ id: "SquareUpOption" });

export const squareUpSchema = z
	.object({
		person: personRefSchema,
		currency: currencyCodeSchema,
	})
	.meta({ id: "SquareUp" });

export const squaredUpSchema = z
	.object({
		id: idSchema,
		/** PROPOSED waits for the other person to confirm; FINALIZED is final. */
		status: z.enum(["PROPOSED", "FINALIZED"]),
		...undoField,
	})
	.meta({ id: "SquaredUp" });

/**
 * Taking a payment back, and squaring up projects with a person: offsets
 * only, no cash, when the overall balance in a currency is even but the
 * projects point in opposite directions.
 */
export const paymentExtrasContract = {
	remove: v1
		.route({
			method: "DELETE",
			path: "/payments/{id}",
			operationId: "removePayment",
			tags: TAG,
			summary: "Withdraw a payment you recorded",
			description:
				"Deletes a payment still waiting for the other person, or voids one that became final without their agreement (money you received, or paid to someone not on Retrospend). A payment the other person confirmed cannot be removed. There is no undo: preview first.",
		})
		.meta({ scope: "write:money", event: "payment.removed" })
		.input(removePaymentSchema)
		.output(paymentRemovedSchema),
	previewRemove: previewTwin({
		path: "/payments/{id}",
		of: "DELETE /payments/{id}",
		operationId: "previewRemovePayment",
		tags: TAG,
		scope: "write:money",
		input: removePaymentSchema,
	}),
	squareUpOptions: v1
		.route({
			method: "GET",
			path: "/people/{type}/{id}/square-up",
			operationId: "getSquareUpOptions",
			tags: TAG,
			summary: "Currencies where squaring up projects with a person helps",
			description:
				"The overall balance is even there, but projects point in opposite directions.",
		})
		.meta({ scope: "read" })
		.input(personParamsSchema)
		.output(z.object({ items: z.array(squareUpOptionSchema) })),
	squareUp: v1
		.route({
			method: "POST",
			path: "/payments/square-up",
			operationId: "squareUpProjects",
			tags: TAG,
			summary: "Square up project balances with a person",
			description:
				"Records offsets only, so every project ends at zero and no money moves. A person on Retrospend confirms or rejects it like a payment. The undo token takes it back through POST /payments/undo.",
			successStatus: 201,
		})
		.meta({ scope: "write:money", event: "payment.squared_up" })
		.input(squareUpSchema)
		.output(squaredUpSchema),
	previewSquareUp: previewTwin({
		path: "/payments/square-up",
		of: "POST /payments/square-up",
		operationId: "previewSquareUpProjects",
		tags: TAG,
		scope: "write:money",
		input: squareUpSchema,
	}),
};
