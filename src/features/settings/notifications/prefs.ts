/** The ten notification types in display order (today's card). */
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
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type Channel = "inApp" | "email" | "digestMode";
export type Pref = { inApp: boolean; email: boolean; digestMode: boolean };

/** A type with no stored row reads as the server creates it: in app on, email off. */
export const DEFAULT_PREF: Pref = {
	inApp: true,
	email: false,
	digestMode: false,
};

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
		a.inApp === b.inApp && a.email === b.email && a.digestMode === b.digestMode
	);
}
