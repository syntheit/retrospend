import { z } from "zod";
import { protectedProcedure } from "~/server/api/trpc";
import { participantRefSchema } from "~/server/services/payments/input";
import { personPage } from "~/server/services/people/detail";
import { peopleOverview } from "~/server/services/people/overview";
import {
	settleContext,
	settleContextSchema,
} from "~/server/services/people/settle-context";
import { undoRecordedPayment } from "~/server/services/people/undo-payment";

/**
 * The redesigned People, Person and Settle up reads (uiV2), spread into the
 * people router. Thin: each calls one service in src/server/services/people.
 */
export const peopleV2Procedures = {
	/** People page: balances, Owed to you and You owe, the bar, Needs you. */
	overview: protectedProcedure.query(({ ctx }) =>
		peopleOverview(ctx.db, ctx.session.user.id),
	),
	/** Person page: balance per currency, projects, payments, shared expenses. */
	page: protectedProcedure
		.input(participantRefSchema)
		.query(({ ctx, input }) => personPage(ctx.db, ctx.session.user.id, input)),
	/** Settle up sheet: open lines and the fill amounts; the preview is settlement.paymentPreview. */
	settleContext: protectedProcedure
		.input(settleContextSchema)
		.query(({ ctx, input }) =>
			settleContext(ctx.db, ctx.session.user.id, input),
		),
	/** The Undo of a payment recorded from the sheet. */
	undoPayment: protectedProcedure
		.input(z.object({ paymentId: z.string().min(1) }))
		.mutation(({ ctx, input }) =>
			undoRecordedPayment(ctx.db, ctx.session.user.id, input.paymentId),
		),
};
