import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { listRecurringView } from "~/server/services/recurring-view.service";

/**
 * The Recurring tab's read, merged into the `recurring` namespace in root.ts
 * (recurring.listView), so today's router file is untouched.
 */
export const recurringViewRouter = createTRPCRouter({
	/** Templates, due states and the cost summary as Money. */
	listView: protectedProcedure.query(({ ctx }) =>
		listRecurringView(ctx.db, ctx.session.user.id, ctx.timeZone),
	),
});
