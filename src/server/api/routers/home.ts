import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { isFlagEnabled } from "~/server/flags";
import { isEmailDeliveryEnabled } from "~/server/lib/email-delivery";
import { glance } from "~/server/services/figures/glance";
import { needsYou } from "~/server/services/needs-you";

/**
 * Home's two reads (IMPLEMENTATION §1.1 Home): Needs you and the glance.
 * Thin: each calls one service; budget parts only with the envelope budget on.
 */
export const homeRouter = createTRPCRouter({
	/** The one Needs you list with counts per group (nav badges read the counts). */
	needsYou: protectedProcedure.query(async ({ ctx }) =>
		needsYou(ctx.db, ctx.session.user.id, {
			budget: await isFlagEnabled("envelopeBudget", ctx.session.user),
			timeZone: ctx.timeZone,
			emailEnabled: await isEmailDeliveryEnabled(),
		}),
	),
	/** Spent this period with its pace, the budget verdict, owed both ways, net worth. */
	glance: protectedProcedure.query(async ({ ctx }) =>
		glance(ctx.db, ctx.session.user.id, {
			budget: await isFlagEnabled("envelopeBudget", ctx.session.user),
			timeZone: ctx.timeZone,
		}),
	),
});
