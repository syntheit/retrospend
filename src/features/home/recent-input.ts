import type { ListV2Input } from "~/server/services/expense-list/types";

/** Recent on Home: the last 5 expenses and refunds, any month (mockup). */
export const RECENT_INPUT: ListV2Input = {
	kinds: ["expense", "refund"],
	limit: 5,
};
