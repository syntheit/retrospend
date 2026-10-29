import type { RetrospendClient } from "@retrospend/api-client";
import type { ActivityItem } from "@/features/activity/source";
import { wireAmount } from "@/features/write/amount";

/**
 * The day one month after `day` ("2026-01-31" gives "2026-02-28"): the month
 * moves on and the day stays, or is the last of a shorter month.
 */
export function nextMonthly(day: string): string {
	const [y, m, d] = day.split("-").map(Number) as [number, number, number];
	const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
	return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

/**
 * Whether an Activity row can become a template: your own expense, not a
 * split or a payment.
 */
export function canRepeat(item: ActivityItem): boolean {
	return item.source === "personal" && item.kind === "expense" && item.mine;
}

/**
 * The exact body of the create, so the sheet can tie one idempotency key to it
 * (a retry after a lost answer replays the first create, never makes a second).
 */
export function templateBody(item: ActivityItem) {
	return {
		name: item.title,
		amount: wireAmount(item.amount.minor, item.amount.currency),
		currency: item.amount.currency,
		...(item.category?.id ? { categoryId: item.category.id } : {}),
		frequency: "MONTHLY" as const,
		nextDueDate: nextMonthly(item.date),
		autoPay: false,
	};
}

/**
 * Makes a monthly template from an expense: the same title, amount, currency
 * and category, next one month after the entry, with auto-pay off so nothing
 * is logged until you confirm it. It creates the template only; no entry and
 * no total changes.
 */
export function createFromExpense(
	api: Pick<RetrospendClient, "recurring">,
	item: ActivityItem,
	idempotencyKey: string,
) {
	return api.recurring.create(templateBody(item), {
		context: { idempotencyKey },
	});
}
