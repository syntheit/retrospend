import { dayKey } from "@/lib/days";
import type { PushPayload } from "@/push/kinds";
import type {
	InboxData,
	InboxNotification,
	InboxPerson,
	InboxProject,
} from "./source";

// What a notification is about, who it came from and how the inbox groups
// it. Pure functions: the screen, the push tap and the tests share them.

type Data = Record<string, unknown>;

const PARTICIPANT_TYPES = ["user", "guest", "shadow"] as const;
export type ParticipantKind = (typeof PARTICIPANT_TYPES)[number];

/** Where a notification or a push leads, in words the router maps to a route. */
export type Target =
	/** An Activity entry by its Activity id (`shared:<id>` for a split). */
	| { kind: "entry"; id: string }
	| { kind: "activity" }
	| { kind: "person"; type: ParticipantKind; id: string }
	| { kind: "people" }
	| { kind: "project"; id: string }
	| { kind: "home" };

function text(data: Data | null, key: string): string | null {
	const value = data?.[key];
	return typeof value === "string" && value !== "" ? value : null;
}

function participant(
	data: Data | null,
	typeKey: string,
	idKey: string,
): { type: ParticipantKind; id: string } | null {
	const type = text(data, typeKey);
	const id = text(data, idKey);
	if (!type || !id) return null;
	return (PARTICIPANT_TYPES as readonly string[]).includes(type)
		? { type: type as ParticipantKind, id }
		: null;
}

/** The person page of a participant, or the People hub when the ids are missing. */
function personOrHub(who: ReturnType<typeof participant>): Target {
	return who ? { kind: "person", ...who } : { kind: "people" };
}

/**
 * Who a notification came from, as the web names them: the person who split
 * or edited an expense, who sent a payment or reminder, who answered one.
 */
export function actorOf(
	n: Pick<InboxNotification, "type" | "data">,
): { type: ParticipantKind; id: string } | null {
	const data = n.data;
	switch (n.type) {
		case "EXPENSE_SPLIT":
		case "EXPENSE_EDITED":
		case "EXPENSE_DELETED":
			return participant(data, "actorType", "actorId");
		case "SETTLEMENT_RECEIVED":
		case "PAYMENT_REMINDER":
			return participant(data, "fromParticipantType", "fromParticipantId");
		case "SETTLEMENT_CONFIRMED":
		case "SETTLEMENT_REJECTED":
			return participant(data, "toParticipantType", "toParticipantId");
		default:
			return null;
	}
}

/**
 * The thing a notification is about. A split or an edit opens the expense;
 * a deleted expense is gone, so it opens the person who deleted it. A
 * payment opens the person it is with, a project notice the project, a fix
 * request the People hub (where it waits). Null when it names nothing.
 */
export function targetOf(
	n: Pick<InboxNotification, "type" | "data">,
): Target | null {
	const data = n.data;
	if (!data) return null;
	switch (n.type) {
		case "EXPENSE_SPLIT":
		case "EXPENSE_EDITED": {
			const id = text(data, "transactionId");
			return id
				? { kind: "entry", id: `shared:${id}` }
				: personOrHub(actorOf(n));
		}
		case "EXPENSE_DELETED":
		case "SETTLEMENT_RECEIVED":
		case "PAYMENT_REMINDER":
		case "SETTLEMENT_CONFIRMED":
		case "SETTLEMENT_REJECTED":
			return personOrHub(actorOf(n));
		case "VERIFICATION_REQUEST":
			return { kind: "people" };
		case "PERIOD_CLOSED":
		case "PARTICIPANT_ADDED": {
			const id = text(data, "projectId");
			return id ? { kind: "project", id } : null;
		}
		default:
			return null;
	}
}

/**
 * Where a push tap goes. A shared expense opens the expense. A fix request
 * opens Activity and a payment (which names no person) the People hub; a
 * recurring item opens Home, where Needs you lists it. The same places as
 * the inbox rows, and as before where a push names too little to open more.
 */
export function pushTarget(
	payload: Pick<PushPayload, "type" | "entity">,
): Target {
	switch (payload.type) {
		case "shared_expense.created":
		case "shared_expense.updated":
			return payload.entity?.type === "shared_expense"
				? { kind: "entry", id: `shared:${payload.entity.id}` }
				: { kind: "activity" };
		case "fix_request.created":
			return { kind: "activity" };
		case "payment.recorded":
		case "payment.confirmed":
		case "payment.not_received":
		case "payment.reminded":
			return { kind: "people" };
		case "recurring.due":
			return { kind: "home" };
	}
}

/** What a row leads with: a person's face, a project's cover, or nothing. */
export type Lead =
	| { kind: "face"; person: InboxPerson }
	| { kind: "cover"; project: InboxProject }
	| null;

export function leadOf(
	n: Pick<InboxNotification, "type" | "data">,
	people: InboxPerson[],
	projects: InboxProject[],
): Lead {
	const who = actorOf(n);
	if (who) {
		const person = people.find((p) => p.key === `${who.type}:${who.id}`);
		if (person) return { kind: "face", person };
	}
	const projectId = text(n.data, "projectId");
	if (projectId) {
		const project = projects.find((p) => p.id === projectId);
		if (project) return { kind: "cover", project };
	}
	return null;
}

/**
 * The one sentence of a row. The server words it in the account's language
 * from the kind, a name and amounts; the title stands in when a note has no
 * body.
 */
export function sentenceOf(n: Pick<InboxNotification, "title" | "body">) {
	return n.body.trim() !== "" ? n.body : n.title;
}

export interface NotificationDay {
	/** YYYY-MM-DD on the phone, which is what a person means by "today". */
	day: string;
	relative: "today" | "yesterday" | null;
	/** Noon of the day, for the date format. */
	date: Date;
	items: InboxNotification[];
}

/** Newest first in, one section per run of the same day out. */
export function groupByDay(
	items: InboxNotification[],
	now: Date,
): NotificationDay[] {
	const today = dayKey(now);
	const yesterday = dayKey(
		new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12),
	);
	const days: NotificationDay[] = [];
	for (const item of items) {
		const when = new Date(item.createdAt);
		const key = dayKey(when);
		const last = days.at(-1);
		if (last && last.day === key) {
			last.items.push(item);
			continue;
		}
		days.push({
			day: key,
			relative:
				key === today ? "today" : key === yesterday ? "yesterday" : null,
			date: new Date(when.getFullYear(), when.getMonth(), when.getDate(), 12),
			items: [item],
		});
	}
	return days;
}

export const NOTIFICATION_FILTERS = [
	"all",
	"expenses",
	"settlements",
	"projects",
] as const;
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

const FILTER_TYPES: Record<
	NotificationFilter,
	InboxNotification["type"][] | null
> = {
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

/** The same four filters as the web inbox, by notification kind. */
export function filterNotifications(
	items: InboxNotification[],
	filter: NotificationFilter,
): InboxNotification[] {
	const types = FILTER_TYPES[filter];
	return types ? items.filter((n) => types.includes(n.type)) : items;
}

export function unreadCount(items: InboxNotification[]): number {
	return items.filter((n) => !n.isRead).length;
}

/** The inbox with these notifications read (all of them when `ids` is null). */
export function withRead(data: InboxData, ids: string[] | null): InboxData {
	return {
		...data,
		items: data.items.map((n) =>
			!n.isRead && (ids === null || ids.includes(n.id))
				? { ...n, isRead: true }
				: n,
		),
	};
}

/** The inbox with a next page added below, never repeating a row it has. */
export function withNextPage(
	data: InboxData,
	page: { items: InboxNotification[]; nextCursor: string | null },
): InboxData {
	const have = new Set(data.items.map((n) => n.id));
	return {
		...data,
		items: [...data.items, ...page.items.filter((n) => !have.has(n.id))],
		nextCursor: page.nextCursor,
	};
}
