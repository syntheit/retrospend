import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
	confirmPaymentSchema,
	participantRefSchema,
	recordPaymentSchema,
} from "~/server/services/payments/input";
import {
	applyConfirm,
	applyPayment,
	previewConfirm,
	previewPayment,
	unconfirm,
} from "~/server/services/payments/procedures";
import { SettlementService } from "~/server/services/shared-expenses/settlement.service";

/** Which way the money moved, from the caller's side. */
const settlementDirectionSchema = z.enum(["outgoing", "incoming"]);

export const settlementRouter = createTRPCRouter({
	/** Settle up sheet (MONEY-MOVES §1, R30): paymentRecord, rolled back. */
	paymentPreview: protectedProcedure
		.input(recordPaymentSchema)
		.query(({ ctx, input }) => previewPayment(ctx.session.user.id, input, ctx.timeZone)),
	/** Records the payment the preview showed; refuses an unconfirmed overpayment. */
	paymentRecord: protectedProcedure
		.input(recordPaymentSchema)
		.mutation(({ ctx, input }) =>
			applyPayment(ctx.db, ctx.session.user.id, input, ctx.timeZone),
		),
	/** Preview of confirming a payment that waits for the caller. */
	paymentConfirmPreview: protectedProcedure
		.input(confirmPaymentSchema)
		.query(({ ctx, input }) => previewConfirm(ctx.db, ctx.session.user.id, input)),
	/** Confirms a payment that waits for the caller; the receiver's details win. */
	paymentConfirm: protectedProcedure
		.input(confirmPaymentSchema)
		.mutation(({ ctx, input }) => applyConfirm(ctx.db, ctx.session.user.id, input)),
	/** Undo of paymentConfirm: the payment waits for the caller again. */
	paymentUnconfirmPreview: protectedProcedure
		.input(z.object({ paymentId: z.string().min(1) }))
		.query(({ ctx, input }) => unconfirm(ctx.db, ctx.session.user.id, input.paymentId, "preview")),
	paymentUnconfirm: protectedProcedure
		.input(z.object({ paymentId: z.string().min(1) }))
		.mutation(({ ctx, input }) => unconfirm(ctx.db, ctx.session.user.id, input.paymentId, "apply")),

	/**
	 * POST /api/settlements
	 *
	 * Creates a new settlement between the current user and toParticipant, who
	 * must have an existing financial relationship with them. With direction
	 * "outgoing" (default) the current user paid toParticipant; with "incoming"
	 * toParticipant paid the current user (recording a payment received, which
	 * is final at once since the payee is the one recording it).
	 *
	 * Returns { settlement, warning } where warning is a string if the settlement
	 * amount exceeds the current balance owed, or null otherwise.
	 *
	 * Partial settlements are supported: the amount does not need to equal the
	 * full balance. A warning is returned (not an error) if the amount exceeds it.
	 */
	create: protectedProcedure
		.input(
			z.object({
				toParticipant: participantRefSchema,
				direction: settlementDirectionSchema.optional(),
				amount: z.number().positive("Amount must be positive"),
				currency: z.string().min(1).max(10),
				paymentMethod: z.string().max(191).nullish(),
				note: z.string().max(500).nullish(),
				// Scope of the settle-up:
				//   string  => that project (cap + row stamped with projectId; both
				//              parties must be project participants)
				//   null    => the direct (project-less) bucket only
				//   omitted => GLOBAL: global cap, and the payment is allocated
				//              across the pair's per-project and direct debts, one
				//              row per scope, so every view stays consistent.
				projectId: z.string().min(1).nullish(),
				// Money received that is not the payer's pending claim (CONFLICT otherwise).
				differentPayment: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const service = new SettlementService(ctx.db, ctx.session.user.id);
			return service.initiateSettlement({ ...input, timeZone: ctx.timeZone });
		}),

	/**
	 * POST /api/settlements/settle-all
	 *
	 * Settles ALL outstanding balances with a person in one batch.
	 * Creates one settlement per currency (atomically), zeroing out all balances.
	 * Each settlement records the converted amount in the payment currency.
	 */
	settleAll: protectedProcedure
		.input(
			z.object({
				toParticipant: participantRefSchema,
				// See create.direction.
				direction: settlementDirectionSchema.optional(),
				paymentCurrency: z.string().min(1).max(10),
				paymentMethod: z.string().max(191).nullish(),
				note: z.string().max(500).nullish(),
				// See create.projectId: same scoping and allocation rules.
				projectId: z.string().min(1).nullish(),
				differentPayment: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const service = new SettlementService(ctx.db, ctx.session.user.id);
			return service.settleAll({ ...input, timeZone: ctx.timeZone });
		}),

	/**
	 * POST /api/settlements/:id/reject
	 *
	 * Rejects a pending payment, its whole payment group. Only the payee can call this.
	 */
	reject: protectedProcedure
		.input(
			z.object({
				id: z.string().min(1),
				reason: z.string().max(500).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const service = new SettlementService(ctx.db, ctx.session.user.id);
			return service.rejectSettlement(input.id, input.reason);
		}),

	/**
	 * Sends a balance reminder notification to someone who owes you.
	 * Does not create a settlement, just nudges them. Rate-limited: 1 per 24h.
	 */
	requestPayment: protectedProcedure
		.input(
			z.object({
				participantType: z.enum(["user", "guest", "shadow"]),
				participantId: z.string().min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const service = new SettlementService(ctx.db, ctx.session.user.id);
			return service.sendBalanceReminder(input);
		}),

});
