import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { ExpenseService } from "~/server/services/expense.service";
import { listV2Input } from "~/server/services/expense-list/types";

/**
 * The v2 expense reads, merged into the `expense` namespace in root.ts
 * (expense.listV2), so today's router file only shrinks (UI-150).
 */
export const expenseV2Router = createTRPCRouter({
	/** Activity (v2): every entry you are part of, filtered, one page at a time. */
	listV2: protectedProcedure
		.input(listV2Input)
		.query(({ ctx, input }) =>
			new ExpenseService(ctx.db).listV2(
				ctx.session.user.id,
				input,
				ctx.timeZone,
			),
		),
});
