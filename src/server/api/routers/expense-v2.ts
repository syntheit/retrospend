import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { listActivity } from "~/server/services/expense-list";
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
});
