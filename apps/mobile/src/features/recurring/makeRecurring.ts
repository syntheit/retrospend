import type { RetrospendClient } from "@retrospend/api-client";
import { addMonthsClamped } from "@retrospend/domain/recurring";
import type { ActivityItem } from "@/features/activity/source";
import { wireAmount } from "@/features/write/amount";
import { dayDate, dayKey } from "@/lib/days";

/**
 * The day one month after `day` ("2026-01-31" gives "2026-02-28"): the month
 * moves on and the day stays, or is the last of a shorter month.
 */
export function nextMonthly(day: string): string {
	return dayKey(addMonthsClamped(dayDate(day), 1));
}

/**
 * The first day on or after `today` that is day `day` of a month ("2026-10-31",
 * 15 gives "2026-11-15"); a month too short for `day` gives its last day.
 */
export function nextOnDay(today: string, day: number): string {
	const from = dayDate(today);
	for (let step = 0; step < 2; step++) {
		const on = dayKey(addMonthsClamped(from, step, day));
		if (on >= today) return on;
	}
	return today;
}

/**
 * Whether an Activity row can become a template: your own expense, not a
 * split or a payment.
 */
export function canRepeat(item: ActivityItem): boolean {
	return (
		!item.unsynced &&
		item.source === "personal" &&
		item.kind === "expense" &&
		item.mine
	);
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
		anchorDay: Number(item.date.slice(8, 10)),
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
