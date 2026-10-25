import * as z from "zod";
import { v1 } from "../common/meta";
import { userText } from "../common/user-text";
import { idSchema, timestampSchema } from "../core";
import { amountTextSchema } from "../ledger";
import { personParamsSchema } from "../people/schemas";

const TAG = ["Payment methods"];

export const PAYMENT_METHOD_VISIBILITIES = [
	"PUBLIC",
	"FRIENDS_ONLY",
	"PAYMENT_ONLY",
] as const;

export const paymentMethodVisibilitySchema = z
	.enum(PAYMENT_METHOD_VISIBILITIES)
	.meta({
		id: "PaymentMethodVisibility",
		description:
			"PUBLIC: anyone. FRIENDS_ONLY and PAYMENT_ONLY: people you share an expense with.",
	});

export const paymentMethodSchema = z
	.object({
		id: idSchema,
		/** What kind it is, for example bank, cash or crypto. */
		type: z.string(),
		label: z.string().nullable(),
		/** The account number, handle or address a payer needs. */
		identifier: z.string().nullable(),
		/** 1 is the one you prefer. */
		rank: z.int().min(1),
		visibility: paymentMethodVisibilitySchema,
		/** Below this amount (in `currency`) the method is not offered. */
		minAmount: z.string().nullable(),
		currency: z.string().nullable(),
		/** For crypto: the network. */
		network: z.string().nullable(),
		updatedAt: timestampSchema,
	})
	.meta({ id: "PaymentMethod" });

export const paymentMethodInputSchema = z
	.object({
		id: idSchema.optional().meta({
			description: "Left out: a new method. A method not sent back is deleted.",
		}),
		type: z.string().min(1).max(50),
		label: userText("payment_method.label", 100).nullish(),
		identifier: userText("payment_method.identifier", 500).nullish(),
		visibility: paymentMethodVisibilitySchema,
		minAmount: amountTextSchema.nullish(),
		currency: z.string().min(1).max(10).nullish(),
		network: z.string().min(1).max(50).nullish(),
	})
	.meta({ id: "PaymentMethodInput" });

export const replacePaymentMethodsSchema = z
	.object({
		methods: z
			.array(paymentMethodInputSchema)
			.max(50)
			.meta({ description: "In order of preference: the first is rank 1." }),
	})
	.meta({ id: "ReplacePaymentMethods" });

/** What another user lets you see of a method. */
export const sharedPaymentMethodSchema = paymentMethodSchema
	.omit({ id: true, updatedAt: true })
	.meta({ id: "SharedPaymentMethod" });

export const matchPaymentMethodsSchema = z
	.object({
		compatible: z.array(
			z.object({
				type: z.string(),
				label: z.string().nullable(),
				/** How to pay them. */
				theirIdentifier: z.string().nullable(),
				yourRank: z.int().min(1),
				theirRank: z.int().min(1),
				/** Lower is better. */
				combinedScore: z.int().min(2),
			}),
		),
		yourMethods: z.array(paymentMethodSchema),
		theirMethods: z.array(sharedPaymentMethodSchema),
	})
	.meta({ id: "PaymentMethodMatch" });

/**
 * How you like to be paid, and how to pay people. Only people on Retrospend
 * have methods. Anyone sees a PUBLIC method; the others are shown to people
 * you share an expense with.
 */
export const paymentMethodsContract = {
	list: v1
		.route({
			method: "GET",
			path: "/payment-methods",
			operationId: "listPaymentMethods",
			tags: TAG,
			summary: "Your payment methods, preferred first",
		})
		.meta({ scope: "read" })
		.output(z.object({ items: z.array(paymentMethodSchema) })),
	replace: v1
		.route({
			method: "PUT",
			path: "/payment-methods",
			operationId: "replacePaymentMethods",
			tags: TAG,
			summary: "Replace your whole list of payment methods",
			description:
				"Send the list as it should be: the order is the preference, and a method left out is deleted.",
		})
		.meta({ scope: "write:settings", event: "payment_methods.replaced" })
		.input(replacePaymentMethodsSchema)
		.output(z.object({ items: z.array(paymentMethodSchema) })),
	match: v1
		.route({
			method: "GET",
			path: "/people/{type}/{id}/payment-methods",
			operationId: "matchPaymentMethods",
			tags: TAG,
			summary: "How to pay a person: the methods you both have",
			description:
				"Ranked by both your preferences. A person without an account has none. Crypto needs the same currency and network.",
		})
		.meta({ scope: "read" })
		.input(personParamsSchema)
		.output(matchPaymentMethodsSchema),
};
