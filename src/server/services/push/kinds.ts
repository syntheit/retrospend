import type { NotificationType } from "~prisma";

/**
 * Which notification channel a push belongs to. The mobile apps create one
 * channel per name (Android) or category (iOS); the names are the contract.
 */
export const PUSH_CHANNELS = [
	"splits",
	"payments",
	"reminders",
	"recurring",
] as const;
export type PushChannel = (typeof PUSH_CHANNELS)[number];

export type PushKindInfo = {
	channel: PushChannel;
	/** The type whose `push` preference switch governs this kind. */
	preference: NotificationType;
};

/**
 * The events that push, and what each one is. An event type missing here
 * never pushes. `recurring.due` is not an outbox event: the worker raises it
 * from the recurring templates.
 */
export const PUSH_KINDS = {
	"shared_expense.created": { channel: "splits", preference: "EXPENSE_SPLIT" },
	"shared_expense.updated": { channel: "splits", preference: "EXPENSE_EDITED" },
	"fix_request.created": {
		channel: "splits",
		preference: "VERIFICATION_REQUEST",
	},
	"payment.recorded": {
		channel: "payments",
		preference: "SETTLEMENT_RECEIVED",
	},
	"payment.confirmed": {
		channel: "payments",
		preference: "SETTLEMENT_CONFIRMED",
	},
	"payment.not_received": {
		channel: "payments",
		preference: "SETTLEMENT_REJECTED",
	},
	"payment.reminded": { channel: "reminders", preference: "PAYMENT_REMINDER" },
	"recurring.due": { channel: "recurring", preference: "RECURRING_DUE" },
} as const satisfies Record<string, PushKindInfo>;

export type PushKind = keyof typeof PUSH_KINDS;

export function pushKindOf(type: string): PushKind | null {
	return Object.hasOwn(PUSH_KINDS, type) ? (type as PushKind) : null;
}
