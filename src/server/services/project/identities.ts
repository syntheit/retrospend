/**
 * Names, avatars and contact redaction for project participants. Every
 * project read resolves people through here, in at most three queries
 * (users, ghosts, guests) however many rows it shows.
 */

import {
	buildContactVisibility,
	redactContact,
} from "~/server/services/shared-expenses/contact-visibility";
import type { ParticipantRef } from "~/server/services/shared-expenses/types";
import { getImageUrl } from "~/server/storage";
import type { PrismaClient } from "~prisma";

interface ParticipantRow {
	participantType: string;
	participantId: string;
}

interface Directory {
	users: Map<
		string,
		{
			name: string | null;
			username?: string | null;
			image: string | null;
			avatarPath: string | null;
		}
	>;
	shadows: Map<string, { name: string | null; email?: string | null }>;
	guests: Map<string, { name: string | null; email?: string | null }>;
}

function idsByType(rows: readonly ParticipantRow[]) {
	const users = new Set<string>();
	const shadows = new Set<string>();
	const guests = new Set<string>();
	for (const p of rows) {
		if (p.participantType === "user" && p.participantId !== "DELETED_USER") {
			users.add(p.participantId);
		} else if (p.participantType === "shadow") {
			shadows.add(p.participantId);
		} else if (p.participantType === "guest") {
			guests.add(p.participantId);
		}
	}
	return { users: [...users], shadows: [...shadows], guests: [...guests] };
}

/** One batch read of everyone in `rows`; emails only when `withContact`. */
async function loadDirectory(
	db: PrismaClient,
	rows: readonly ParticipantRow[],
	withContact: boolean,
): Promise<Directory> {
	const ids = idsByType(rows);
	const [users, shadows, guests] = await Promise.all([
		ids.users.length > 0
			? db.user.findMany({
					where: { id: { in: ids.users } },
					select: {
						id: true,
						name: true,
						username: withContact,
						image: true,
						avatarPath: true,
					},
				})
			: [],
		ids.shadows.length > 0
			? db.shadowProfile.findMany({
					where: { id: { in: ids.shadows } },
					select: { id: true, name: true, email: withContact },
				})
			: [],
		ids.guests.length > 0
			? db.guestSession.findMany({
					where: { id: { in: ids.guests } },
					select: { id: true, name: true, email: withContact },
				})
			: [],
	]);
	return {
		users: new Map(users.map((u) => [u.id, u])),
		shadows: new Map(shadows.map((s) => [s.id, s])),
		guests: new Map(guests.map((g) => [g.id, g])),
	};
}

const userAvatar = (
	user: { image: string | null; avatarPath: string | null } | undefined,
) => getImageUrl(user?.avatarPath ?? null) ?? user?.image ?? null;

/**
 * Adds name, email, username and avatar to participant rows. Emails come
 * back unredacted: pass the result through redactParticipantEmails before it
 * leaves the server.
 */
export async function resolveParticipantNames<T extends ParticipantRow>(
	db: PrismaClient,
	participants: T[],
) {
	const dir = await loadDirectory(db, participants, true);
	return participants.map((p) => {
		if (p.participantType === "user") {
			if (p.participantId === "DELETED_USER") {
				return {
					...p,
					name: "Deleted User",
					email: null,
					username: null,
					avatarUrl: null,
				};
			}
			const user = dir.users.get(p.participantId);
			return {
				...p,
				name: user?.name ?? "Unknown",
				email: null,
				username: user?.username ?? null,
				avatarUrl: userAvatar(user),
			};
		}
		const other =
			p.participantType === "shadow"
				? dir.shadows.get(p.participantId)
				: dir.guests.get(p.participantId);
		return {
			...p,
			name: other?.name ?? "Unknown",
			email: other?.email ?? null,
			username: null,
			avatarUrl: null,
		};
	});
}

/**
 * Applies the shared contact-visibility rule (contact-visibility.ts) to
 * resolved participants. `viewer` is null for viewer links, who see none.
 */
export async function redactParticipantEmails<
	T extends ParticipantRow & { email: string | null },
>(db: PrismaClient, viewer: ParticipantRef | null, items: T[]): Promise<T[]> {
	const visible = await buildContactVisibility(db, viewer, items);
	return items.map((item) => redactContact(item, visible));
}

export type Identity = { name: string; avatarUrl: string | null };

/** Names and avatars (no contact details) keyed by "type:id". */
export async function batchResolveIdentities(
	db: PrismaClient,
	entries: readonly ParticipantRow[],
): Promise<Map<string, Identity>> {
	const dir = await loadDirectory(db, entries, false);
	const result = new Map<string, Identity>();
	for (const [id, u] of dir.users) {
		result.set(`user:${id}`, {
			name: u.name ?? "Unknown",
			avatarUrl: userAvatar(u),
		});
	}
	for (const [id, s] of dir.shadows) {
		result.set(`shadow:${id}`, { name: s.name ?? "Unknown", avatarUrl: null });
	}
	for (const [id, g] of dir.guests) {
		result.set(`guest:${id}`, { name: g.name ?? "Unknown", avatarUrl: null });
	}
	result.set("user:DELETED_USER", { name: "Deleted User", avatarUrl: null });
	return result;
}
