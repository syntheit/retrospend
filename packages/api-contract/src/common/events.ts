import * as z from "zod";

/**
 * Event types (IMPLEMENTATION §2.2): every service mutation appends one
 * ApiEvent to the outbox in its own transaction, read by
 * `GET /events?after=`, webhooks and push. A type is `<resource>.<verb>`
 * in snake_case, past tense (`expense.created`, `payment.confirmed`,
 * `budget_envelope.moved`). Every write route names the event it emits in
 * its meta, and the contract test checks the name is registered here.
 * Groups add their types to EVENT_TYPES when they add the writes.
 */
export const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export const EVENT_TYPES = [
	// G1 core (S3b)
	"category.created",
	"category.deleted",
	"category.merged",
	"category.updated",
	"category_preference.deleted",
	"category_preference.updated",
	"favorite_rate.added",
	"favorite_rate.removed",
	"favorite_rates.reordered",
	"notification.all_marked_read",
	"notification.marked_read",
	"notification_preferences.updated",
	"page_settings.updated",
	"profile.avatar_removed",
	"profile.avatar_updated",
	"profile.background_updated",
	"profile.email_change_cancelled",
	"profile.updated",
	"push_device.registered",
	"push_device.removed",
	"rates.sync_requested",
	"settings.updated",
	"token.created",
	"token.revoked",
	// G2 ledger (S3b)
	"expense.created",
	"expense.deleted",
	"expense.undone",
	"expense.updated",
	"expenses.categorized",
	"income.created",
	"income.deleted",
	"income.undone",
	"recurring.confirmed",
	"recurring.created",
	"recurring.deleted",
	"recurring.undone",
	"recurring.updated",
	"transfer.created",
	"transfer.deleted",
	"transfer.undone",
	// G3 people and projects (S3c)
	"payment.confirmed",
	"payment.not_received",
	"payment.recorded",
	"payment.reminded",
	"payment.undone",
	"person.claim_link_created",
	"person.created",
	"person.reminded",
	"person.updated",
	"project.settle_all_undone",
	"project.settled_all",
	"shared_expense.accepted",
	"shared_expense.created",
	"shared_expense.deleted",
	"shared_expense.rejected",
	"shared_expense.undone",
	"shared_expense.updated",
] as const satisfies readonly string[];

export type EventType = (typeof EVENT_TYPES)[number];

export const eventTypeSchema = z
	.string()
	.regex(EVENT_TYPE_PATTERN)
	.meta({ id: "EventType", examples: ["expense.created"] });

export function isEventTypeName(value: string): boolean {
	return EVENT_TYPE_PATTERN.test(value);
}
