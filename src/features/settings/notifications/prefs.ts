import { PUSH_NOTIFICATION_TYPES } from "@retrospend/api-contract";

/** The notification types in display order. */
export const NOTIFICATION_TYPES = [
	"EXPENSE_SPLIT",
	"VERIFICATION_REQUEST",
	"EXPENSE_EDITED",
	"EXPENSE_DELETED",
	"SETTLEMENT_RECEIVED",
	"SETTLEMENT_CONFIRMED",
	"SETTLEMENT_REJECTED",
	"PERIOD_CLOSED",
	"PARTICIPANT_ADDED",
	"PAYMENT_REMINDER",
	"RECURRING_DUE",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type Channel = "inApp" | "push" | "email" | "digestMode";
export type Pref = {
	inApp: boolean;
	push: boolean;
	email: boolean;
	digestMode: boolean;
};

/** A type with no stored row reads as the server creates it: in app and push on, email off. */
export const DEFAULT_PREF: Pref = {
	inApp: true,
	push: true,
	email: false,
	digestMode: false,
};

/**
 * The switches a type has, in column order. A recurring item is only ever a
 * push; the types with no push have no Push switch.
 */
export function channelsOf(type: NotificationType): Channel[] {
	if (type === "RECURRING_DUE") return ["push"];
	return PUSH_NOTIFICATION_TYPES.includes(type)
		? ["inApp", "push", "email", "digestMode"]
		: ["inApp", "email", "digestMode"];
}

/**
 * One switch flipped. The digest batches emails, so it needs Email: turning
 * Email off turns the digest off too, and the digest cannot turn on
 * without Email (the switch is disabled; this guards it anyway).
 */
export function flip(pref: Pref, channel: Channel, on: boolean): Pref {
	if (channel === "digestMode" && on && !pref.email) return pref;
	const next = { ...pref, [channel]: on };
	if (channel === "email" && !on) next.digestMode = false;
	return next;
}

export function samePref(a: Pref, b: Pref): boolean {
	return (
		a.inApp === b.inApp &&
		a.push === b.push &&
		a.email === b.email &&
		a.digestMode === b.digestMode
	);
}
