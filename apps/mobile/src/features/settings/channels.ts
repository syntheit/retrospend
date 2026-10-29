import {
	INBOX_NOTIFICATION_TYPES,
	PUSH_NOTIFICATION_TYPES,
} from "@retrospend/api-contract";
import type { NotificationPreference, NotificationType } from "./source";

export type NotificationChannel = "inApp" | "email" | "push";

/** Whether a type makes an inbox entry and an email (a recurring due does not). */
export function hasInbox(type: NotificationType): boolean {
	return (INBOX_NOTIFICATION_TYPES as readonly NotificationType[]).includes(
		type,
	);
}

/** Whether the server pushes a type. */
export function hasPush(type: NotificationType): boolean {
	return (PUSH_NOTIFICATION_TYPES as readonly NotificationType[]).includes(
		type,
	);
}

/**
 * The channels a type has that are on, in the order the sheet lists them. A
 * channel a type does not have (a recurring due has no inbox entry or email)
 * is never counted; push counts only when `pushOn` says the phone has it.
 */
export function channelsOn(
	preference: NotificationPreference,
	pushOn: boolean,
): NotificationChannel[] {
	const out: NotificationChannel[] = [];
	const inbox = hasInbox(preference.type);
	if (inbox && preference.inApp) out.push("inApp");
	if (inbox && preference.email) out.push("email");
	if (pushOn && hasPush(preference.type) && preference.push) {
		out.push("push");
	}
	return out;
}
