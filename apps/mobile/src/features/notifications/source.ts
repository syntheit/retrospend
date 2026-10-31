import type { RetrospendClient } from "@retrospend/api-client";
import type { CacheKey } from "@/features/read/loadCached";

// The notifications inbox, from API v1. Shapes are the contract's own, so a
// server change shows up here as a type error.

export type NotificationPage = Awaited<
	ReturnType<RetrospendClient["notifications"]["list"]>
>;
export type InboxNotification = NotificationPage["items"][number];
export type NotificationType = InboxNotification["type"];

/** Who a notification can name: from People, keyed `<type>:<id>`. */
export interface InboxPerson {
	key: string;
	name: string;
	imageUrl: string | null;
}

/** The project a notification can name, for its cover. */
export interface InboxProject {
	id: string;
	name: string;
	imageUrl: string | null;
}

/**
 * What the inbox keeps on the phone: the first page, and the people and
 * projects the rows need for a face or a cover. A notification carries only
 * ids, so the faces come from the two lists the phone already reads.
 */
export interface InboxData {
	items: InboxNotification[];
	nextCursor: string | null;
	people: InboxPerson[];
	projects: InboxProject[];
}

export const INBOX_CACHE: CacheKey = { name: "notifications.inbox", schema: 1 };
export const PAGE = 50;

/**
 * The first page and the faces for it. The notifications must arrive; a
 * failed People or Projects read only leaves rows without a face.
 */
export function fetchInbox(api: RetrospendClient) {
	return async (): Promise<InboxData> => {
		const [page, people, projects] = await Promise.all([
			api.notifications.list({ limit: PAGE }),
			api.people.list().then(
				(overview) =>
					overview.people.map(
						({ person }): InboxPerson => ({
							key: person.key,
							name: person.name,
							imageUrl: person.imageUrl,
						}),
					),
				() => [] as InboxPerson[],
			),
			api.projects.list().then(
				(list) =>
					list.items.map(
						(p): InboxProject => ({
							id: p.id,
							name: p.name,
							imageUrl: p.imageUrl,
						}),
					),
				() => [] as InboxProject[],
			),
		]);
		return {
			items: page.items,
			nextCursor: page.nextCursor,
			people,
			projects,
		};
	};
}
