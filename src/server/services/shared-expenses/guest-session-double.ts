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

/** Prisma's `equals` with `mode: "insensitive"` is an unescaped ILIKE: `%`, `_` and `\` are special. */
function ilike(pattern: string, text: string): boolean {
	let source = "";
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i] as string;
		const literal = c === "\\" ? (pattern[++i] ?? "") : null;
		if (literal === null && c === "%") source += "[\\s\\S]*";
		else if (literal === null && c === "_") source += "[\\s\\S]";
		else source += (literal ?? c).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${source}$`, "i").test(text);
}

type Where = Record<string, unknown>;

function matches(gs: GuestSessionRecord, w: Where = {}): boolean {
	const { email, emailHash, id, projectId } = w;
	if (email !== undefined && !isInsensitiveEquals(email))
		throw new Error("guestSession double: email filter not supported");
	if (isInsensitiveEquals(email) && !ilike(email.equals, gs.email)) return false;
	if (emailHash !== undefined && gs.emailHash !== emailHash) return false;
	const ids = (id as { in?: string[] } | undefined)?.in;
	if (ids && !ids.includes(gs.id)) return false;
	if (typeof projectId === "string" && gs.projectId !== projectId) return false;
	const projects = (projectId as { in?: string[] } | undefined)?.in;
	if (typeof projectId === "object" && projects && !projects.includes(gs.projectId))
		return false;
	return true;
}

export function makeGuestSessionModel(
	guestSessions: Map<string, GuestSessionRecord>,
	nextId: () => string,
) {
	return {
		findFirst: vi.fn(
			(args: { where?: Where } = {}) =>
				[...guestSessions.values()].find((gs) => matches(gs, args.where)) ??
				null,
		),
		findUnique: vi.fn((args: { where: { id: string } }) => {
			return guestSessions.get(args.where.id) ?? null;
		}),
		findMany: vi.fn((args: { where?: Where } = {}) =>
			[...guestSessions.values()].filter((gs) => matches(gs, args.where)),
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
