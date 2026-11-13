/**
 * The in-memory guestSession model of the shared-expenses test db
 * (test-utils.ts). `findFirst` answers what `contactLookup` returns: the
 * stored hash, or the address ignoring case. A `where` on `email` in any other
 * shape throws, so the double never ignores a filter it does not understand.
 */
import { vi } from "vitest";

export interface GuestSessionRecord {
	id: string;
	name: string;
	email: string;
	emailHash?: string | null;
	magicLinkId: string;
	projectId: string;
	sessionToken: string;
	lastActiveAt: Date;
	createdAt: Date;
}

type InsensitiveEquals = { equals: string; mode: "insensitive" };
const isInsensitiveEquals = (value: unknown): value is InsensitiveEquals =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as InsensitiveEquals).equals === "string";

export function makeGuestSessionModel(
	guestSessions: Map<string, GuestSessionRecord>,
	nextId: () => string,
) {
	return {
		findFirst: vi.fn((args: { where?: Record<string, unknown> } = {}) => {
			for (const gs of guestSessions.values()) {
				const { email, emailHash } = args.where ?? {};
				if (email !== undefined && !isInsensitiveEquals(email))
					throw new Error("guestSession double: email filter not supported");
				if (
					isInsensitiveEquals(email) &&
					gs.email.toLowerCase() !== email.equals.toLowerCase()
				)
					continue;
				if (emailHash !== undefined && gs.emailHash !== emailHash) continue;
				if (
					args.where?.projectId !== undefined &&
					gs.projectId !== args.where.projectId
				)
					continue;
				return gs;
			}
			return null;
		}),
		findUnique: vi.fn((args: { where: { id: string } }) => {
			return guestSessions.get(args.where.id) ?? null;
		}),
		findMany: vi.fn(
			(
				args: {
					where?: {
						id?: { in?: string[] };
						projectId?: { in?: string[] } | string;
					};
				} = {},
			) =>
				[...guestSessions.values()].filter((gs) => {
					const w = args.where;
					if (w?.id?.in && !w.id.in.includes(gs.id)) return false;
					if (typeof w?.projectId === "string" && gs.projectId !== w.projectId)
						return false;
					if (
						typeof w?.projectId === "object" &&
						w.projectId.in &&
						!w.projectId.in.includes(gs.projectId)
					)
						return false;
					return true;
				}),
		),
		create: vi.fn((args: { data: Partial<GuestSessionRecord> }) => {
			const id = nextId();
			const record: GuestSessionRecord = {
				id,
				name: args.data.name ?? "Guest",
				email: args.data.email ?? "",
				emailHash: args.data.emailHash ?? null,
				magicLinkId: args.data.magicLinkId ?? "",
				projectId: args.data.projectId ?? "",
				sessionToken: args.data.sessionToken ?? "",
				lastActiveAt: new Date(),
				createdAt: new Date(),
			};
			guestSessions.set(id, record);
			return record;
		}),
		update: vi.fn(
			(args: { where: { id: string }; data: Partial<GuestSessionRecord> }) => {
				const gs = guestSessions.get(args.where.id);
				if (!gs) throw new Error("Guest session not found");
				const updated = { ...gs, ...args.data };
				guestSessions.set(args.where.id, updated);
				return updated;
			},
		),
	};
}
