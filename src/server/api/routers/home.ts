import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { isFlagEnabled } from "~/server/flags";
import { isEmailDeliveryEnabled } from "~/server/lib/email-delivery";
import { glance } from "~/server/services/figures/glance";
import { needsYou } from "~/server/services/needs-you";
import { snooze, unsnooze } from "~/server/services/needs-you/snooze";

/** An item's stable id: `<type>:<entity id>`, or the type alone. */
const itemIdSchema = z
	.string()
	.min(3)
	.max(255)
	.regex(/^[a-z]+\.[A-Za-z]+(:.+)?$/);

/**
 * Home's reads (IMPLEMENTATION 1.1 Home): Needs you and the glance, plus
 * Later on a Needs you item. Thin: each calls one service; budget parts only
 * with the envelope budget on.
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
	/** Later: hides one item until the start of tomorrow. `id` is made by the client. */
	snoozeNeedsYou: protectedProcedure
		.input(z.object({ id: z.string().min(1).max(64), itemId: itemIdSchema }))
		.mutation(({ ctx, input }) =>
			snooze(ctx.db, ctx.session.user.id, input, { timeZone: ctx.timeZone }),
		),
	/** Undo of Later: the item comes back now. */
	unsnoozeNeedsYou: protectedProcedure
		.input(z.object({ itemId: itemIdSchema }))
		.mutation(({ ctx, input }) => unsnooze(ctx.db, ctx.session.user.id, input)),
});
