import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { SettlementService } from "~/server/services/shared-expenses/settlement.service";

const participantRefSchema = z.object({
	participantType: z.enum(["user", "guest", "shadow"]),
	participantId: z.string().min(1),
});

export const settlementRouter = createTRPCRouter({
	/**
	 * POST /api/settlements
	 *
	 * Creates a new settlement. The current user is always the payer (from_participant).
	 * The to_participant must have an existing financial relationship with the current user.
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
				amount: z.number().positive("Amount must be positive"),
				currency: z.string().min(1).max(10),
				convertedAmount: z.number().positive().nullish(),
				convertedCurrency: z.string().min(1).max(10).nullish(),
				exchangeRateUsed: z.number().positive().nullish(),
				paymentMethod: z.string().max(191).nullish(),
				note: z.string().max(500).nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const service = new SettlementService(ctx.db, ctx.session.user.id);
			return service.initiateSettlement(input);
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
				paymentCurrency: z.string().min(1).max(10),
				paymentMethod: z.string().max(191).nullish(),
				note: z.string().max(500).nullish(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const service = new SettlementService(ctx.db, ctx.session.user.id);
			return service.settleAll(input);
		}),

	/**
	 * POST /api/settlements/:id/confirm
	 *
	 * Confirms receipt of a settlement. Only the payee (to_participant) can call this.
	 * Sets confirmedByPayee=true, status=FINALIZED, settledAt=now.
	 * The settlement is immutable after confirmation.
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
	 * Deletes an unconfirmed (pending) settlement. Only the payer can delete.
	 * Confirmed settlements cannot be deleted: they are permanent records.
	 */
	deletePending: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const service = new SettlementService(ctx.db, ctx.session.user.id);
			return service.deletePendingSettlement(input.id);
		}),

	/**
	 * POST /api/settlements/:id/reject
	 *
	 * Rejects a pending settlement. Only the payee can call this.
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
	 * Returns PROPOSED settlements where the current user is the payee.
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
		.input(participantRefSchema)
		.query(async ({ ctx, input }) => {
			const service = new SettlementService(ctx.db, ctx.session.user.id);
			return service.getSettlementPlan(input);
		}),

	/**
	 * GET /api/settlements/history/:personRef
	 *
	 * Returns all settlement records between the current user and the specified
	 * person, sorted by initiatedAt descending.
	 *
	 * Includes: amount, currency, convertedAmount/currency, exchangeRateUsed,
	 * paymentMethod, note, status, direction, initiatedAt, settledAt.
	 */
	history: protectedProcedure
		.input(participantRefSchema)
		.query(async ({ ctx, input }) => {
			const service = new SettlementService(ctx.db, ctx.session.user.id);
			return service.getSettlementHistory(input);
		}),
});
