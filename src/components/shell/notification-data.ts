/**
 * What the notifications popover shows and where a notification leads. The
 * same rules as today's bell (src/components/notification-bell.tsx), which
 * keeps its own copy until the cut-over (S6) deletes the old shell.
 */
import type { RouterOutputs } from "~/trpc/react";

export type ShellNotification =
	RouterOutputs["notification"]["list"]["items"][number];
type NotificationType = ShellNotification["type"];

export const NOTIFICATION_FILTERS = [
	"all",
	"expenses",
	"settlements",
	"projects",
] as const;
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

const FILTER_TYPES: Record<NotificationFilter, NotificationType[] | null> = {
	all: null,
	expenses: ["EXPENSE_SPLIT", "EXPENSE_EDITED", "EXPENSE_DELETED"],
	settlements: [
		"SETTLEMENT_RECEIVED",
		"SETTLEMENT_CONFIRMED",
		"SETTLEMENT_REJECTED",
		"PAYMENT_REMINDER",
	],
	projects: ["PERIOD_CLOSED", "PARTICIPANT_ADDED", "VERIFICATION_REQUEST"],
};

export function isNotificationFilter(
	value: unknown,
): value is NotificationFilter {
	return NOTIFICATION_FILTERS.includes(value as NotificationFilter);
}

export function filterNotifications<N extends { type: NotificationType }>(
	items: N[],
	filter: NotificationFilter,
): N[] {
	const types = FILTER_TYPES[filter];
	return types ? items.filter((n) => types.includes(n.type)) : items;
}

type Data = Record<string, string> | null;

function personHref(type: string | undefined, id: string | undefined) {
	return type && id ? `/people/${type}/${id}` : "/people";
}

/** The page a notification opens. */
export function notificationHref(n: {
	type: NotificationType;
	data: unknown;
}): string | null {
	const data = n.data as Data;
	if (!data) return null;
	switch (n.type) {
		case "EXPENSE_SPLIT":
		case "EXPENSE_EDITED":
		case "EXPENSE_DELETED":
			return personHref(data.actorType, data.actorId);
		case "VERIFICATION_REQUEST":
			return "/people";
		case "SETTLEMENT_RECEIVED":
		case "PAYMENT_REMINDER":
			return personHref(data.fromParticipantType, data.fromParticipantId);
		case "SETTLEMENT_CONFIRMED":
		case "SETTLEMENT_REJECTED":
			return personHref(data.toParticipantType, data.toParticipantId);
		case "PERIOD_CLOSED":
		case "PARTICIPANT_ADDED":
			return data.projectId ? `/projects/${data.projectId}` : "/projects";
		default:
			return null;
	}
}

/** An edited or deleted expense also opens its revision history. */
export function historyTransactionId(n: {
	type: NotificationType;
	data: unknown;
}): string | null {
	if (n.type !== "EXPENSE_EDITED" && n.type !== "EXPENSE_DELETED") return null;
	return (n.data as Data)?.transactionId ?? null;
}
