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
	applyUnconfirm,
	previewConfirm,
	previewPayment,
} from "~/server/services/payments/procedures";
import { SettlementService } from "~/server/services/shared-expenses/settlement.service";

/** Which way the money moved, from the caller's side. */
const settlementDirectionSchema = z.enum(["outgoing", "incoming"]);

export const settlementRouter = createTRPCRouter({
	/**
	 * Settle up sheet (MONEY-MOVES §1, R30): the same mutation as
	 * paymentRecord, rolled back: allocation ("This pays", remainder,
	 * overpay), a "Same payment?" match, and what changes and does not.
	 */
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
		.query(({ ctx, input }) =>
			previewConfirm(ctx.db, ctx.session.user.id, input),
		),
	/** Confirms a payment that waits for the caller; the receiver's details win. */
	paymentConfirm: protectedProcedure
		.input(confirmPaymentSchema)
		.mutation(({ ctx, input }) =>
			applyConfirm(ctx.db, ctx.session.user.id, input),
		),

	/** Undo of paymentConfirm: the payment waits for the caller again. */
	paymentUnconfirm: protectedProcedure
		.input(z.object({ paymentId: z.string().min(1) }))
		.mutation(({ ctx, input }) =>
			applyUnconfirm(ctx.db, ctx.session.user.id, input.paymentId),
		),

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
	 * POST /api/settlements/:id/confirm
	 *
	 * Confirms receipt of a payment. Only the person it waits for (the payee)
	 * can call this. Every row of its payment group turns FINALIZED together
	 * and is immutable after confirmation.
	 */
	confirm: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const service = new SettlementService(ctx.db, ctx.session.user.id);
			return service.confirmSettlement(input.id);
		}),

	/**
	 * DELETE /api/settlements/:id
	 *
	 * Deletes an unconfirmed (pending) payment with all its rows. Only the payer can delete.
	 * Confirmed settlements cannot be deleted: they are permanent records.
	 */
	deletePending: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const service = new SettlementService(ctx.db, ctx.session.user.id);
			return service.deletePendingSettlement(input.id);
		}),

	/**
	 * POST /api/settlements/:id/void
	 *
	 * Voids (undoes) an auto-finalized settlement whose payee is a non-user
	 * (shadow or guest). Only the payer can call this. The payee can also void
	 * a payment they recorded themselves as received (direction "incoming").
	 *
	 * A settlement to a shadow/guest auto-finalizes on creation (the payee can
	 * never authenticate to confirm), which would otherwise permanently rewrite a
	 * balance with no recourse. Voiding hard-deletes every row of its payment group, restoring the balance
	 * (balances are recomputed from the remaining settlement rows).
	 *
	 * Settlements to a real user payee, genuinely confirmed settlements, and
	 * pending (PROPOSED) settlements are NOT voidable via this endpoint.
	 */
	void: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const service = new SettlementService(ctx.db, ctx.session.user.id);
			return service.voidAutoFinalizedSettlement(input.id);
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
	 * POST /api/settlements/:id/remind
	 *
	 * Sends a reminder notification for a pending settlement.
	 * Rate-limited: max 3 reminders, minimum 24h between each.
	 */
	sendReminder: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const service = new SettlementService(ctx.db, ctx.session.user.id);
			return service.sendReminder(input.id);
		}),

	/**
	 * GET /api/settlements/pending-for-me
	 *
	 * Returns the pending payments waiting for the current user to confirm,
	 * one entry per payment group.
	 */
	pendingForMe: protectedProcedure.query(async ({ ctx }) => {
		const service = new SettlementService(ctx.db, ctx.session.user.id);
		return service.getPendingForMe();
	}),

	/**
	 * Sends a balance reminder notification to someone who owes you.
	 * Does not create a settlement — just nudges them. Rate-limited: 1 per 24h.
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

	/**
	 * GET /api/settlements/plan/:personRef
	 *
	 * Returns per-currency balances and suggested settlement amounts between the
	 * current user and the specified person. Read-only, no side effects.
	 *
	 * Each entry includes:
	 * - currency: the currency code
	 * - balance: absolute value of the net balance
	 * - direction: "they_owe_you" | "you_owe_them" | "settled"
	 * - suggestedAmount: same as balance (the full settlement amount to zero out)
	 */
	plan: protectedProcedure
		.input(
			participantRefSchema.extend({
				// See create.projectId: scopes the returned balances/plan. Omitted =>
				// global balances (the default for the cross-project People view).
				projectId: z.string().min(1).nullish(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const service = new SettlementService(ctx.db, ctx.session.user.id);
			return service.getSettlementPlan(
				{
					participantType: input.participantType,
					participantId: input.participantId,
				},
				input.projectId,
			);
		}),

	/**
	 * GET /api/settlements/history/:personRef
	 *
	 * Returns the payments between the current user and the specified person,
	 * one entry per payment group, sorted by initiatedAt descending.
	 *
	 * Includes: amount, currency, parts (per project, offsets marked),
	 * paymentMethod, note, status, direction, initiatedAt, settledAt and the
	 * action flags for the whole group.
	 */
	history: protectedProcedure
		.input(participantRefSchema)
		.query(async ({ ctx, input }) => {
			const service = new SettlementService(ctx.db, ctx.session.user.id);
			return service.getSettlementHistory(input);
		}),

	/**
	 * Currencies where the overall balance with the person is even but their
	 * project balances point in opposite directions. Read-only.
	 */
	squareUpOptions: protectedProcedure
		.input(participantRefSchema)
		.query(async ({ ctx, input }) => {
			const service = new SettlementService(ctx.db, ctx.session.user.id);
			return service.getSquareUpOptions(input);
		}),

	/**
	 * Records offset rows only (no cash) so every project ends at zero when
	 * the overall balance in that currency is already even. The other person
	 * confirms or rejects it like a payment.
	 */
	squareUp: protectedProcedure
		.input(
			z.object({
				toParticipant: participantRefSchema,
				currency: z.string().min(1).max(10),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const service = new SettlementService(ctx.db, ctx.session.user.id);
			return service.squareUpProjects(input);
		}),
});
