import type { NotificationType } from "@/features/settings/source";

// What a push is, as the server names it (src/server/services/push/kinds.ts
// and message.ts). The channel names are the contract between the server and
// the apps: the APNs `category` and the Android notification channel id.

export const PUSH_CHANNELS = [
	"splits",
	"payments",
	"reminders",
	"recurring",
] as const;
export type PushChannel = (typeof PUSH_CHANNELS)[number];

export interface PushKindInfo {
	channel: PushChannel;
	/** The notification type whose `push` switch governs this kind. */
	preference: NotificationType;
	/** The key of the text in the `push` message namespace. */
	textKey: string;
}

export const PUSH_KINDS = {
	"shared_expense.created": {
		channel: "splits",
		preference: "EXPENSE_SPLIT",
		textKey: "sharedExpenseCreated",
	},
	"shared_expense.updated": {
		channel: "splits",
		preference: "EXPENSE_EDITED",
		textKey: "sharedExpenseUpdated",
	},
	"fix_request.created": {
		channel: "splits",
		preference: "VERIFICATION_REQUEST",
		textKey: "fixRequestCreated",
	},
	"payment.recorded": {
		channel: "payments",
		preference: "SETTLEMENT_RECEIVED",
		textKey: "paymentRecorded",
	},
	"payment.confirmed": {
		channel: "payments",
		preference: "SETTLEMENT_CONFIRMED",
		textKey: "paymentConfirmed",
	},
	"payment.not_received": {
		channel: "payments",
		preference: "SETTLEMENT_REJECTED",
		textKey: "paymentNotReceived",
	},
	"payment.reminded": {
		channel: "reminders",
		preference: "PAYMENT_REMINDER",
		textKey: "paymentReminded",
	},
	"recurring.due": {
		channel: "recurring",
		preference: "RECURRING_DUE",
		// recurringDueOut or recurringDueIn, by direction (see textKeyOf).
		textKey: "recurringDueOut",
	},
} as const satisfies Record<string, PushKindInfo>;

export type PushKind = keyof typeof PUSH_KINDS;

export function pushKindOf(type: string): PushKind | null {
	return Object.hasOwn(PUSH_KINDS, type) ? (type as PushKind) : null;
}

/** The text key of a kind; a recurring item names its direction. */
export function textKeyOf(kind: PushKind, direction?: "in" | "out"): string {
	return kind === "recurring.due" && direction === "in"
		? "recurringDueIn"
		: PUSH_KINDS[kind].textKey;
}

/** The machine part of a push (PushData on the server): ids only, never text. */
export interface PushPayload {
	type: PushKind;
	channel: PushChannel;
	entity: { type: string; id: string } | null;
	direction?: "in" | "out";
}

/**
 * The payload an APNs notification carries (its `data` key) or a local one
 * was built with; null when it is not one of ours, so a stray notification
 * opens nothing.
 */
export function parsePushPayload(value: unknown): PushPayload | null {
	if (typeof value !== "object" || value === null) return null;
	const v = value as Record<string, unknown>;
	const kind = typeof v.type === "string" ? pushKindOf(v.type) : null;
	if (v.v !== 1 || !kind) return null;
	const entity = v.entity as { type?: unknown; id?: unknown } | null;
	return {
		type: kind,
		channel: PUSH_KINDS[kind].channel,
		entity:
			entity && typeof entity.type === "string" && typeof entity.id === "string"
				? { type: entity.type, id: entity.id }
				: null,
		...(v.direction === "in" || v.direction === "out"
			? { direction: v.direction }
			: {}),
	};
}

/**
 * Where a tap goes. A shared expense or a fix request lands in Activity, a
 * payment in People (where payments to confirm and Settle up are), a
 * recurring item in Home (Needs you lists it with its actions). A push names
 * the thing but not the person, so People opens the hub, not one person.
 */
export function routeFor(kind: PushKind): "/activity" | "/people" | "/home" {
	switch (kind) {
		case "shared_expense.created":
		case "shared_expense.updated":
		case "fix_request.created":
			return "/activity";
		case "payment.recorded":
		case "payment.confirmed":
		case "payment.not_received":
		case "payment.reminded":
			return "/people";
		case "recurring.due":
			return "/home";
	}
}

/** The link an Android notification opens, handled by Expo Router. */
export function deepLinkFor(kind: PushKind): string {
	return `retrospend://${routeFor(kind).slice(1)}`;
}
