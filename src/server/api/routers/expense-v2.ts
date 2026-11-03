import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { activityRow, listActivity } from "~/server/services/expense-list";
import { listV2Input } from "~/server/services/expense-list/types";

/**
 * The v2 expense reads, merged into the `expense` namespace in root.ts
 * (expense.listV2), so today's router file only shrinks (UI-150).
 */
export const expenseV2Router = createTRPCRouter({
	/** Activity (v2): every entry you are part of, filtered, one page at a time. */
	listV2: protectedProcedure
		.input(listV2Input)
		// Personal expenses, your shares and payments in one cursor-paginated
		// read; the shaping lives in services/expense-list, not in the
		// already full expense.service.ts (UI-150).
		.query(({ ctx, input }) =>
			listActivity(ctx.db, ctx.session.user.id, input, ctx.timeZone),
		),
	/** One line of Activity as the list shapes it (the detail pane's figures). */
	rowV2: protectedProcedure
		.input(z.object({ id: z.string().min(1).max(200) }))
		.query(({ ctx, input }) =>
			activityRow(ctx.db, ctx.session.user.id, input.id, ctx.timeZone),
		),
});
