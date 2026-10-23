/**
 * Transport schemas of the payment procedures. Amounts and rates are decimal
 * strings, never floats: the server turns them into minor units.
 */
import { z } from "zod";

const decimal = z
	.string()
	.regex(/^\d{1,13}(\.\d{1,8})?$/, "Enter an amount like 1234.56");
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date");
const currency = z.string().min(1).max(10);

export const participantRefSchema = z.object({
	participantType: z.enum(["user", "guest", "shadow"]),
	participantId: z.string().min(1),
});

export const recordPaymentSchema = z.object({
	person: participantRefSchema,
	direction: z.enum(["outgoing", "incoming"]),
	currency,
	/** null pays everything. */
	amount: decimal.nullable(),
	rateType: z.string().min(1).max(32).nullish(),
	customRate: z.object({ rate: decimal, currency }).nullish(),
	paymentMethod: z.string().max(191).nullish(),
	paidOn: isoDay.nullish(),
	note: z.string().max(500).nullish(),
	applyTo: z
		.array(
			z.object({
				/** A project id, or null for Outside projects; omitted = every scope. */
				scope: z.string().min(1).nullable().optional(),
				currency: currency.optional(),
			}),
		)
		.max(50)
		.optional(),
	allowOverpay: z.boolean().optional(),
	/** The amount is the Everything the sheet showed; refused if that moved. */
	everything: z.boolean().optional(),
	matchClaimId: z.string().min(1).nullish(),
	differentPayment: z.boolean().optional(),
});

export const confirmPaymentSchema = z.object({
	/** The payment id, or the id of one of its settlement rows. */
	paymentId: z.string().min(1),
	paymentMethod: z.string().max(191).nullish(),
	paidOn: isoDay.nullish(),
	amount: decimal.nullish(),
});
