import * as z from "zod";
import { v1 } from "../common/meta";
import {
	currencyCodeSchema,
	moneySchema,
	rateTypeSchema,
} from "../common/money";
import { undoTokenSchema } from "../common/preview";
import { userText } from "../common/user-text";
import { idSchema } from "../core";
import {
	amountTextSchema,
	daySchema,
	previewTwin,
	rateTextSchema,
	undoField,
	undoInputSchema,
} from "../ledger";
import { personRefSchema } from "../people/schemas";

const TAG = ["Payments"];

/** A scope is a project id; null is Outside projects. */
const scopeIdSchema = idSchema.nullable();

export const paymentRowSchema = z.object({
	/** Null is Outside projects. */
	scope: scopeIdSchema,
	/** What it pays of that scope's debt, in the debt's currency. */
	pays: moneySchema,
	/** The same in the payment currency. */
	paid: moneySchema,
	/** How the debt currency converts into the payment currency; null when it is the same. */
	rate: z.object({ rateType: z.string(), perUnit: z.string() }).nullable(),
	/** More than that scope owes. */
	excess: z.boolean(),
});

/** What a payment pays and cancels, from the allocator that writes it. */
export const allocationSchema = z
	.object({
		amount: moneySchema,
		/** "Everything" in the payment currency. */
		full: moneySchema,
		everything: z.boolean(),
		rows: z.array(paymentRowSchema),
		/** Debts the other way that this payment cancels without cash. */
		offsets: z.array(
			z.object({
				scope: scopeIdSchema,
				cancels: moneySchema,
				owedBy: z.enum(["payer", "payee"]),
				value: moneySchema,
			}),
		),
		/** What is still owed after it. */
		remainder: z.array(z.object({ scope: scopeIdSchema, owed: moneySchema })),
		/** More than everything owed; recorded only with allowOverpay. */
		overpay: moneySchema.nullable(),
		/** Currencies left untouched for want of a rate. */
		unpriced: z.array(z.string()),
	})
	.meta({ id: "PaymentAllocation" });

/**
 * The `detail` of the record and confirm previews: what the payment would
 * pay and cancel, the same allocation the write answers with.
 */
export const paymentPreviewDetailSchema = z
	.object({
		kind: z.enum(["payment.record", "payment.confirm"]),
		allocation: allocationSchema.nullable(),
	})
	.meta({ id: "PaymentPreviewDetail" });

export const recordPaymentSchema = z
	.object({
		id: z.uuid().optional().meta({
			description:
				"A client-made id. Sending the same id twice is a conflict, not a second payment.",
		}),
		person: personRefSchema,
		/** "outgoing": you paid them. "incoming": they paid you, and it is final at once. */
		direction: z.enum(["outgoing", "incoming"]),
		currency: currencyCodeSchema,
		amount: amountTextSchema.nullable().meta({
			description: "Null pays everything that is owed.",
		}),
		rateType: rateTypeSchema.nullish(),
		customRate: z
			.object({ rate: rateTextSchema, currency: currencyCodeSchema })
			.nullish()
			.meta({
				description:
					"A typed rate: `rate` units of `currency` (the payment currency) per 1 unit of the debt currency named here.",
			}),
		paymentMethod: userText("payment.method", 191).nullish(),
		paidOn: daySchema.nullish().meta({ description: "Today when omitted." }),
		note: userText("payment.note", 500).nullish(),
		applyTo: z
			.array(
				z.object({
					scope: scopeIdSchema.optional().meta({
						description:
							"A project id, null for Outside projects, omitted for every scope.",
					}),
					currency: currencyCodeSchema.optional(),
				}),
			)
			.max(50)
			.optional(),
		allowOverpay: z.boolean().optional(),
		everything: z.boolean().optional().meta({
			description:
				"The amount is the Everything the sheet showed; refused if that moved since.",
		}),
		matchClaimId: idSchema.nullish().meta({
			description:
				"Same payment: confirm this pending payment of theirs instead of recording a second one.",
		}),
		differentPayment: z.boolean().optional().meta({
			description:
				"Money received that is not the payment they already say they made.",
		}),
	})
	.meta({ id: "RecordPayment" });

export const paymentWriteSchema = z
	.object({
		id: idSchema,
		/** PROPOSED waits for the other person; FINALIZED is final. */
		status: z.enum(["PROPOSED", "FINALIZED"]),
		/** Null when it confirmed their payment as it was (matchClaimId). */
		allocation: allocationSchema.nullable(),
		...undoField,
	})
	.meta({ id: "PaymentWrite" });

export const paymentIdParamsSchema = z.object({ id: idSchema });

export const confirmPaymentSchema = z
	.object({
		id: idSchema,
		paymentMethod: userText("payment.method", 191).nullish(),
		paidOn: daySchema.nullish().meta({
			description: "Left out: the payer's date stands.",
		}),
		amount: amountTextSchema.nullish().meta({
			description:
				"What you really received, when it differs. Left out: the payer's amount stands.",
		}),
	})
	.meta({ id: "ConfirmPayment" });

export const paymentConfirmedSchema = z
	.object({
		id: idSchema,
		allocation: allocationSchema.nullable(),
		...undoField,
	})
	.meta({ id: "PaymentConfirmed" });

export const notReceivedSchema = z
	.object({
		id: idSchema,
		reason: userText("payment.reject_reason", 500).optional(),
	})
	.meta({ id: "PaymentNotReceived" });

export const paymentRejectedSchema = z
	.object({ id: idSchema, status: z.literal("REJECTED") })
	.meta({ id: "PaymentRejected" });

export const paymentUndoResultSchema = z
	.object({
		id: idSchema,
		/** Puts the undo back. Null for the undo of a record: take-backs of a new payment have no redo. */
		redo: undoTokenSchema.nullable(),
	})
	.meta({ id: "PaymentUndo" });

/**
 * Settling up between two people. The money writes have a preview twin that
 * answers the figures they would move, and an undo token for
 * POST /payments/undo (not received has none: the payer deletes or records
 * again). Reading the payments with a person: GET /people/{type}/{id}.
 */
export const paymentsContract = {
	record: v1
		.route({
			method: "POST",
			path: "/payments",
			operationId: "recordPayment",
			tags: TAG,
			summary: "Record a payment between you and a person",
			description:
				"Allocated across the projects and currencies you owe in. Money you receive is final at once; a payment to a person on Retrospend waits for them to confirm. More than is owed needs allowOverpay.",
			successStatus: 201,
		})
		.meta({ scope: "write:money", event: "payment.recorded" })
		.input(recordPaymentSchema)
		.output(paymentWriteSchema),
	previewRecord: previewTwin({
		path: "/payments",
		of: "POST /payments",
		operationId: "previewRecordPayment",
		tags: TAG,
		scope: "write:money",
		input: recordPaymentSchema,
	}),
	confirm: v1
		.route({
			method: "POST",
			path: "/payments/{id}/confirm",
			operationId: "confirmPayment",
			tags: TAG,
			summary: "Confirm a payment that waits for you",
			description:
				"Your details win: you may correct the method, the date and the amount received.",
		})
		.meta({ scope: "write:money", event: "payment.confirmed" })
		.input(confirmPaymentSchema)
		.output(paymentConfirmedSchema),
	previewConfirm: previewTwin({
		path: "/payments/{id}/confirm",
		of: "POST /payments/{id}/confirm",
		operationId: "previewConfirmPayment",
		tags: TAG,
		scope: "write:money",
		input: confirmPaymentSchema,
	}),
	notReceived: v1
		.route({
			method: "POST",
			path: "/payments/{id}/not-received",
			operationId: "rejectPayment",
			tags: TAG,
			summary: "Say a payment never came",
			description:
				"Rejects a payment that waits for you. The debt comes back and the payer is told.",
		})
		.meta({ scope: "write:money", event: "payment.not_received" })
		.input(notReceivedSchema)
		.output(paymentRejectedSchema),
	previewNotReceived: previewTwin({
		path: "/payments/{id}/not-received",
		of: "POST /payments/{id}/not-received",
		operationId: "previewRejectPayment",
		tags: TAG,
		scope: "write:money",
		input: notReceivedSchema,
	}),
	remind: v1
		.route({
			method: "POST",
			path: "/payments/{id}/remind",
			operationId: "remindPayment",
			tags: TAG,
			summary: "Remind the payee about a payment that waits for them",
			description:
				"Only the person who recorded it, at most 3 times and not twice in 24 hours. Records nothing.",
		})
		.meta({ scope: "write:expenses", event: "payment.reminded" })
		.input(paymentIdParamsSchema)
		.output(z.object({ ok: z.literal(true) })),
	undo: v1
		.route({
			method: "POST",
			path: "/payments/undo",
			operationId: "undoPaymentWrite",
			tags: TAG,
			summary: "Revert a payment write from its undo token",
			description:
				"Tokens from record and confirm. A payment still waiting for the other person is deleted, one that was final at once is voided, a confirm goes back to waiting. A token is for its user and expires after 24 hours.",
		})
		.meta({ scope: "write:money", event: "payment.undone" })
		.input(undoInputSchema)
		.output(paymentUndoResultSchema),
	previewUndo: previewTwin({
		path: "/payments/undo",
		of: "POST /payments/undo",
		operationId: "previewUndoPaymentWrite",
		tags: TAG,
		scope: "write:money",
		input: undoInputSchema,
	}),
};
