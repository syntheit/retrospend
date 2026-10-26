import { db } from "~/server/db";
import { recurringItems } from "~/server/services/needs-you/activity";
import { resolveTimeZone } from "~/server/services/user-time-zone";
import type { PushConfig } from "./config";
import { enqueuePushes, type PushDraft } from "./enqueue";
import { newPushData } from "./message";

/**
 * Recurring items are the one push that no event announces: nothing is
 * written when a due date arrives. This reads the templates the same way
 * Needs you does (`recurringItems`: due or overdue in the person's own
 * calendar, and not one the sidecar is about to post), and pushes each due
 * date once. The dedupe key is the template and its due day, so the next
 * sweep, another worker, or a later date change that lands on the same day
 * never repeats it.
 *
 * Only templates that fell due in the last few days count, so switching
 * push on does not announce items that have been overdue for months.
 *
 * The template's name is never read: the push says that something is due,
 * and the amount when the template has a fixed one.
 */

const DAY_MS = 86_400_000;
const LOOKBACK_DAYS = 3;

export async function raiseRecurringDue(
	config: PushConfig,
	now = new Date(),
): Promise<number> {
	const templates = await db.recurringTemplate.findMany({
		where: {
			isActive: true,
			nextDueDate: {
				gt: new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS),
				// A day ahead covers calendars east of UTC.
				lt: new Date(now.getTime() + DAY_MS),
			},
		},
		select: {
			id: true,
			userId: true,
			amount: true,
			currency: true,
			direction: true,
			amountMode: true,
			autoPay: true,
			nextDueDate: true,
			user: { select: { timeZone: true } },
		},
	});
	if (templates.length === 0) return 0;

	const drafts: PushDraft[] = [];
	const byUser = new Map<string, typeof templates>();
	for (const t of templates)
		byUser.set(t.userId, [...(byUser.get(t.userId) ?? []), t]);
	for (const [userId, own] of byUser) {
		const zone = resolveTimeZone(own[0]?.user.timeZone);
		const items = recurringItems(
			own.map((t) => ({ ...t, name: "" })),
			now,
			zone,
		);
		for (const item of items) {
			if (!item.entity || !item.date) continue;
			drafts.push({
				userId,
				eventId: null,
				dedupeKey: `recurring:${item.entity.id}:${item.date}`,
				data: newPushData("recurring.due", {
					entity: { type: "recurring", id: item.entity.id },
					amount: item.askAmount ? null : item.amount,
					direction: item.direction ?? undefined,
				}),
			});
		}
	}
	if (drafts.length === 0) return 0;
	return db.$transaction((tx) => enqueuePushes(tx, config, drafts, now));
}
