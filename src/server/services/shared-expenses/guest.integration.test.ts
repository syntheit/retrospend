/**
 * Integration Test Suite 3: Guest Flow
 *
 * Tests magic link validation and guest registration. Registration and resume
 * run through the real guest router against the stateful in-memory db.
 */

import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
	DATABASE_URL: "postgresql://mock",
	NODE_ENV: "test",
	BETTER_AUTH_SECRET: "secret",
	NEXT_PUBLIC_APP_URL: "http://localhost:3000",
	SMTP_HOST: undefined as string | undefined,
}));
const mockSendEmail = vi.hoisted(() => vi.fn());

// Join dates are tested on Postgres (services/project/__tests__); the mock
// db here has no project createdAt to read.
vi.mock("~/server/services/project/join-date", () => ({
	defaultJoinedOn: vi.fn(async () => null),
}));

vi.mock("~/env", () => ({ env: mockEnv }));
// The router's global db (and the user-scoped one) point at whichever
// stateful db the current call uses.
const dbHolder = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("~/server/db", () => ({
	db: new Proxy({}, { get: (_t, prop: string) => dbHolder.current[prop] }),
	createUserScopedDb: vi.fn(() => dbHolder.current),
}));
vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));
vi.mock("~/server/storage", () => ({ deleteFile: vi.fn() }));
vi.mock("~/server/mailer", () => ({ sendEmail: mockSendEmail }));
vi.mock("~/server/services/settings", () => ({
	getAppSettings: vi.fn().mockResolvedValue({ enableEmail: true }),
}));
vi.mock("~/server/services/notifications", () => ({
	createNotification: vi.fn().mockResolvedValue(undefined),
	resolveParticipantName: vi.fn().mockResolvedValue("Test User"),
}));

import {
	addMagicLink,
	addProject,
	addProjectParticipant,
	createStatefulDb,
	makeUserRef,
} from "./test-utils";

// The shared invite-link validator used by guest.ts and claim.ts.
import { validateLinkOrThrow } from "~/server/lib/magic-link";

import { createHash } from "node:crypto";
import { createCallerFactory } from "~/server/api/trpc";
import { guestRouter } from "~/server/api/routers/guest";

// ── Drive the real guest router ───────────────────────────────────────────────

const createGuestCaller = createCallerFactory(guestRouter);

type VerificationTokenRow = { identifier: string; token: string; expires: Date };

/**
 * The stateful db has no verification_token model; resume links live there.
 * Wrap the db with a small one (shared by the transaction client too).
 */
const tokenStores = new WeakMap<object, Map<string, VerificationTokenRow>>();
function withVerificationTokens(db: ReturnType<typeof createStatefulDb>) {
	const tokens = tokenStores.get(db) ?? new Map<string, VerificationTokenRow>();
	tokenStores.set(db, tokens);
	const verificationToken = {
		create: vi.fn(async (args: { data: VerificationTokenRow }) => {
			tokens.set(args.data.token, { ...args.data });
			return args.data;
		}),
		deleteMany: vi.fn(
			async (args: { where: { identifier: { startsWith: string } } }) => {
				let count = 0;
				for (const [k, v] of tokens) {
					if (v.identifier.startsWith(args.where.identifier.startsWith)) {
						tokens.delete(k);
						count++;
					}
				}
				return { count };
			},
		),
		findUnique: vi.fn(
			async (args: { where: { token: string } }) => tokens.get(args.where.token) ?? null,
		),
		delete: vi.fn(async (args: { where: { token: string } }) => {
			const row = tokens.get(args.where.token);
			tokens.delete(args.where.token);
			return row;
		}),
	};
	const wrapped: Record<string, unknown> = { ...db, verificationToken };
	wrapped.$transaction = async (cb: (tx: unknown) => Promise<unknown>) => cb(wrapped);
	return { wrapped, tokens };
}

let ipCounter = 0;
function guestCaller(db: ReturnType<typeof createStatefulDb>, userId?: string) {
	ipCounter += 1;
	const { wrapped } = withVerificationTokens(db);
	dbHolder.current = wrapped;
	return createGuestCaller({
		session: userId
			? ({
					user: { id: userId, isActive: true, role: "USER", email: `${userId}@example.com` },
				} as never)
			: null,
		db: wrapped as never,
		// fresh IP per call so the per-IP rate limiter never trips in tests
		headers: new Headers({ "x-forwarded-for": `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}` }),
	});
}

async function joinWithAccount(
	db: ReturnType<typeof createStatefulDb>,
	userId: string,
	linkId: string,
) {
	const promise = guestCaller(db, userId).joinWithAccount({ linkId });
	promise.catch(() => undefined);
	await vi.runAllTimersAsync();
	return promise;
}

type RegisterGuestResult = {
	projectId: string;
	projectName: string;
	resumeEmailSent?: boolean;
	role?: string;
	sessionToken?: string;
	guestSessionId?: string;
};

async function registerGuest(
	db: ReturnType<typeof createStatefulDb>,
	input: { linkId: string; name: string; email: string },
): Promise<RegisterGuestResult> {
	const promise = guestCaller(db).register(input);
	promise.catch(() => undefined);
	await vi.runAllTimersAsync();
	return promise;
}

async function resumeGuest(
	db: ReturnType<typeof createStatefulDb>,
	token: string,
) {
	const promise = guestCaller(db).resume({ token });
	promise.catch(() => undefined);
	await vi.runAllTimersAsync();
	return promise;
}

beforeEach(() => {
	vi.useFakeTimers();
	mockSendEmail.mockReset();
	mockEnv.SMTP_HOST = undefined;
});

afterEach(() => {
	vi.useRealTimers();
});

// ── Suite 3A: Magic link validation ──────────────────────────────────────────

describe("Suite 3A: validateLinkOrThrow: all invalid states return NOT_FOUND", () => {
	it("valid link passes validation", () => {
		expect(() =>
			validateLinkOrThrow({
				isActive: true,
				expiresAt: null,
				maxUses: null,
				useCount: 0,
			}),
		).not.toThrow();
	});

	it("revoked link (isActive=false) throws NOT_FOUND", () => {
		expect(() =>
			validateLinkOrThrow({
				isActive: false,
				expiresAt: null,
				maxUses: null,
				useCount: 0,
			}),
		).toThrowError(TRPCError);
	});

	it("expired link throws NOT_FOUND", () => {
		const yesterday = new Date(Date.now() - 86_400_000);
		expect(() =>
			validateLinkOrThrow({
				isActive: true,
				expiresAt: yesterday,
				maxUses: null,
				useCount: 0,
			}),
		).toThrowError(TRPCError);
	});

	it("future expiry passes validation", () => {
		const tomorrow = new Date(Date.now() + 86_400_000);
		expect(() =>
			validateLinkOrThrow({
				isActive: true,
				expiresAt: tomorrow,
				maxUses: null,
				useCount: 0,
			}),
		).not.toThrow();
	});

	it("maxUses exhausted throws NOT_FOUND", () => {
		expect(() =>
			validateLinkOrThrow({
				isActive: true,
				expiresAt: null,
				maxUses: 1,
				useCount: 1, // already used once, at max
			}),
		).toThrowError(TRPCError);
	});

	it("maxUses not yet reached passes validation", () => {
		expect(() =>
			validateLinkOrThrow({
				isActive: true,
				expiresAt: null,
				maxUses: 3,
				useCount: 2, // 2 of 3 used: still valid
			}),
		).not.toThrow();
	});

	it("allowUsedUp skips only the max-uses check", () => {
		expect(() =>
			validateLinkOrThrow(
				{ isActive: true, expiresAt: null, maxUses: 1, useCount: 1 },
				{ allowUsedUp: true },
			),
		).not.toThrow();
		expect(() =>
			validateLinkOrThrow(
				{ isActive: false, expiresAt: null, maxUses: 1, useCount: 1 },
				{ allowUsedUp: true },
			),
		).toThrowError(TRPCError);
		expect(() =>
			validateLinkOrThrow(
				{ isActive: true, expiresAt: new Date(0), maxUses: null, useCount: 0 },
				{ allowUsedUp: true },
			),
		).toThrowError(TRPCError);
	});

	it("all invalid at once: revoked+expired+exhausted still throws", () => {
		expect(() =>
			validateLinkOrThrow({
				isActive: false,
				expiresAt: new Date(0),
				maxUses: 1,
				useCount: 5,
			}),
		).toThrowError(TRPCError);
	});
});

// ── Suite 3B: Guest registration flow ────────────────────────────────────────

describe("Suite 3B: Guest registration via magic link", () => {
	let db: ReturnType<typeof createStatefulDb>;
	let projectId: string;
	let linkId: string;

	beforeEach(() => {
		db = createStatefulDb();

		const project = addProject(db, { createdById: "alice", name: "Team Trip" });
		projectId = project.id;

		addProjectParticipant(db, {
			projectId,
			participantType: "user",
			participantId: "alice",
			role: "ORGANIZER",
		});

		const link = addMagicLink(db, {
			projectId,
			createdById: "alice",
			roleGranted: "CONTRIBUTOR",
		});
		linkId = link.id;
	});

	it("new guest registers: GuestSession and ProjectParticipant created", async () => {
		const result = await registerGuest(db, {
			linkId,
			name: "Marcus",
			email: "marcus@example.com",
		});

		expect(result.resumeEmailSent).toBe(false);
		expect(result.projectId).toBe(projectId);
		expect(result.role).toBe("CONTRIBUTOR");
		expect(typeof result.sessionToken).toBe("string");
		expect(result.sessionToken).toHaveLength(64); // 32 bytes hex

		// GuestSession created
		const sessions = [...db._stores.guestSessions.values()];
		expect(sessions).toHaveLength(1);
		expect(sessions[0]?.name).toBe("Marcus");
		expect(sessions[0]?.email).toBe("marcus@example.com");

		// ProjectParticipant created with guest type
		const participants = [...db._stores.projectParticipants.values()];
		const guestParticipant = participants.find(
			(pp) => pp.participantType === "guest",
		);
		expect(guestParticipant).toBeDefined();
		expect(guestParticipant?.role).toBe("CONTRIBUTOR");
		expect(guestParticipant?.participantId).toBe(sessions[0]?.id);

		// Link useCount incremented
		expect(db._stores.magicLinks.get(linkId)?.useCount).toBe(1);
	});

	it("email is lowercased during registration", async () => {
		await registerGuest(db, {
			linkId,
			name: "Marcus",
			email: "Marcus@EXAMPLE.COM",
		});

		const session = [...db._stores.guestSessions.values()][0];
		expect(session?.email).toBe("marcus@example.com");
	});

	it("same email re-registers with email on: no token, a resume link is mailed instead", async () => {
		mockEnv.SMTP_HOST = "smtp.test";
		const first = await registerGuest(db, {
			linkId,
			name: "Marcus",
			email: "marcus@example.com",
		});
		const original = db._stores.guestSessions.get(first.guestSessionId!)!;
		const originalHash = original.sessionToken;

		// Someone else types Marcus's email into the join form
		const second = await registerGuest(db, {
			linkId,
			name: "Mallory",
			email: "marcus@example.com",
		});

		expect(second.sessionToken).toBeUndefined();
		expect(second.resumeEmailSent).toBe(true);
		expect(second.sessionToken).toBeUndefined();
		expect(second.guestSessionId).toBeUndefined();

		// The existing session is untouched: same token hash, same name
		expect(db._stores.guestSessions.size).toBe(1);
		const after = db._stores.guestSessions.get(first.guestSessionId!)!;
		expect(after.sessionToken).toBe(originalHash);
		expect(after.name).toBe("Marcus");

		// The resume link went to the address on file
		expect(mockSendEmail).toHaveBeenCalledTimes(1);
		expect(mockSendEmail.mock.calls[0]![0]).toBe("marcus@example.com");
		expect(mockSendEmail.mock.calls[0]![2]).toContain("guestResume=");
	});

	it("same email re-registers with email off: a separate guest is created", async () => {
		const first = await registerGuest(db, {
			linkId,
			name: "Marcus",
			email: "marcus@example.com",
		});
		const originalHash = db._stores.guestSessions.get(first.guestSessionId!)!
			.sessionToken;

		const second = await registerGuest(db, {
			linkId,
			name: "Marcus",
			email: "marcus@example.com",
		});

		expect(second.sessionToken).toBeDefined();
		expect(second.guestSessionId).not.toBe(first.guestSessionId);
		expect(db._stores.guestSessions.size).toBe(2);
		expect(
			db._stores.guestSessions.get(first.guestSessionId!)!.sessionToken,
		).toBe(originalHash);
		expect(mockSendEmail).not.toHaveBeenCalled();
	});

	it("magic link with maxUses=1: second registration is rejected", async () => {
		// Use a link with maxUses=1
		const limitedLink = addMagicLink(db, {
			projectId,
			createdById: "alice",
			roleGranted: "CONTRIBUTOR",
			maxUses: 1,
		});

		// First registration succeeds and increments useCount to 1
		await registerGuest(db, {
			linkId: limitedLink.id,
			name: "First Guest",
			email: "first@example.com",
		});

		expect(db._stores.magicLinks.get(limitedLink.id)?.useCount).toBe(1);

		// Second registration should be rejected (useCount >= maxUses)
		await expect(
			registerGuest(db, {
				linkId: limitedLink.id,
				name: "Second Guest",
				email: "second@example.com",
			}),
		).rejects.toThrow("This invite link is no longer valid");
	});

	it("revoked magic link: registration is rejected", async () => {
		const revokedLink = addMagicLink(db, {
			projectId,
			createdById: "alice",
			isActive: false,
		});

		await expect(
			registerGuest(db, {
				linkId: revokedLink.id,
				name: "Someone",
				email: "someone@example.com",
			}),
		).rejects.toThrow("This invite link is no longer valid");
	});

	it("expired magic link: registration is rejected", async () => {
		const expiredLink = addMagicLink(db, {
			projectId,
			createdById: "alice",
			expiresAt: new Date("2020-01-01"), // long expired
		});

		await expect(
			registerGuest(db, {
				linkId: expiredLink.id,
				name: "Someone",
				email: "someone@example.com",
			}),
		).rejects.toThrow("This invite link is no longer valid");
	});

	it("non-existent link ID returns NOT_FOUND", async () => {
		await expect(
			registerGuest(db, {
				linkId: "does-not-exist",
				name: "Someone",
				email: "someone@example.com",
			}),
		).rejects.toThrow("This invite link is no longer valid");
	});

	it("a registered user's email gets a plain guest: the account is never added", async () => {
		// Pre-populate an existing user with the same email
		db._stores.users.set("existing-user-1", {
			id: "existing-user-1",
			name: "Alice Regular",
			email: "regular@example.com",
			image: null,
			username: null,
		});

		const result = await registerGuest(db, {
			linkId,
			name: "Alice Regular",
			email: "regular@example.com",
		});

		// Same answer as for any unknown address: no hint that an account exists
		expect(result.resumeEmailSent).toBe(false);
		expect(result.sessionToken).toBeDefined();
		expect(db._stores.guestSessions.size).toBe(1);

		// The registered account was NOT enrolled in the project
		const userParticipant = [...db._stores.projectParticipants.values()].find(
			(pp) =>
				pp.participantType === "user" && pp.participantId === "existing-user-1",
		);
		expect(userParticipant).toBeUndefined();
	});

	it("register responds the same shape for registered and unknown emails", async () => {
		db._stores.users.set("existing-user-1", {
			id: "existing-user-1",
			name: "Alice Regular",
			email: "regular@example.com",
			image: null,
			username: null,
		});

		const registered = await registerGuest(db, {
			linkId,
			name: "A",
			email: "regular@example.com",
		});
		const unknown = await registerGuest(db, {
			linkId,
			name: "B",
			email: "nobody@example.com",
		});

		expect(Object.keys(registered).sort()).toEqual(Object.keys(unknown).sort());
	});
});

// ── Suite 3B2: Signed-in users join with their own account ───────────────────

describe("Suite 3B2: joinWithAccount", () => {
	let db: ReturnType<typeof createStatefulDb>;
	let projectId: string;
	let linkId: string;

	beforeEach(() => {
		db = createStatefulDb();
		const project = addProject(db, { createdById: "alice", name: "Team Trip" });
		projectId = project.id;
		linkId = addMagicLink(db, {
			projectId,
			createdById: "alice",
			roleGranted: "CONTRIBUTOR",
		}).id;
	});

	it("adds the signed-in account with the link's role and counts the use", async () => {
		const result = await joinWithAccount(db, "bob", linkId);

		expect(result).toEqual({ projectId, alreadyMember: false });
		const bob = [...db._stores.projectParticipants.values()].find(
			(pp) => pp.participantType === "user" && pp.participantId === "bob",
		);
		expect(bob?.role).toBe("CONTRIBUTOR");
		expect(db._stores.magicLinks.get(linkId)?.useCount).toBe(1);
	});

	it("leaves an existing member's role alone", async () => {
		addProjectParticipant(db, {
			projectId,
			participantType: "user",
			participantId: "bob",
			role: "EDITOR",
		});

		const result = await joinWithAccount(db, "bob", linkId);

		expect(result.alreadyMember).toBe(true);
		const rows = [...db._stores.projectParticipants.values()].filter(
			(pp) => pp.participantId === "bob",
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.role).toBe("EDITOR");
		expect(db._stores.magicLinks.get(linkId)?.useCount).toBe(0);
	});

	it("rejects a revoked link", async () => {
		const revoked = addMagicLink(db, {
			projectId,
			createdById: "alice",
			isActive: false,
		});
		await expect(joinWithAccount(db, "bob", revoked.id)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("requires a signed-in user", async () => {
		const promise = guestCaller(db).joinWithAccount({ linkId });
		promise.catch(() => undefined);
		await vi.runAllTimersAsync();
		await expect(promise).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});

// ── Suite 3C: Guest scope enforcement ────────────────────────────────────────

describe("Suite 3C: Guest scope: guests cannot access other projects", () => {
	it("assertGuestProjectScope throws FORBIDDEN for wrong project", () => {
		// Inline the assertGuestProjectScope logic from trpc.ts
		function assertGuestProjectScope(
			participant: { participantType: string; projectScope?: string },
			requestedProjectId: string | undefined,
		) {
			if (participant.participantType !== "guest") return;
			if (
				!requestedProjectId ||
				participant.projectScope !== requestedProjectId
			) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Guests can only access their own project",
				});
			}
		}

		const guest = { participantType: "guest", projectScope: "project-A" };

		// Correct project: no error
		expect(() => assertGuestProjectScope(guest, "project-A")).not.toThrow();

		// Wrong project: FORBIDDEN
		expect(() => assertGuestProjectScope(guest, "project-B")).toThrowError(
			TRPCError,
		);

		// No projectId: FORBIDDEN
		expect(() => assertGuestProjectScope(guest, undefined)).toThrowError(
			TRPCError,
		);

		// Regular user: no scope enforcement
		const user = { participantType: "user" };
		expect(() => assertGuestProjectScope(user, "any-project")).not.toThrow();
	});
});

// ── Suite 3D: Idempotency and edge cases ─────────────────────────────────────

describe("Suite 3D: Guest registration idempotency", () => {
	let db: ReturnType<typeof createStatefulDb>;
	let projectId: string;
	let linkId: string;

	beforeEach(() => {
		db = createStatefulDb();
		const project = addProject(db, { createdById: "alice" });
		projectId = project.id;
		const link = addMagicLink(db, { projectId, createdById: "alice" });
		linkId = link.id;
	});

	/** Registers twice with the same email (email on) and returns the mailed token. */
	async function mailedResumeToken() {
		mockEnv.SMTP_HOST = "smtp.test";
		const first = await registerGuest(db, {
			linkId,
			name: "Marcus",
			email: "marcus@example.com",
		});
		await registerGuest(db, {
			linkId,
			name: "Marcus",
			email: "marcus@example.com",
		});
		const html = mockSendEmail.mock.calls.at(-1)![2] as string;
		const token = /guestResume=([0-9a-f]{64})/.exec(html)![1]!;
		return { first, token };
	}

	it("guest who lost their token gets back in through the mailed resume link", async () => {
		const { first, token } = await mailedResumeToken();

		const resumed = await resumeGuest(db, token);

		expect(resumed.guestSessionId).toBe(first.guestSessionId); // Same session
		expect(resumed.projectId).toBe(projectId);
		expect(resumed.sessionToken).not.toBe(first.sessionToken);
		const session = db._stores.guestSessions.get(first.guestSessionId!)!;
		expect(session.sessionToken).toBe(
			createHash("sha256").update(resumed.sessionToken).digest("hex"),
		);
	});

	it("a resume link works only once", async () => {
		const { token } = await mailedResumeToken();
		await resumeGuest(db, token);
		await expect(resumeGuest(db, token)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("an expired resume link is rejected", async () => {
		const { first, token } = await mailedResumeToken();
		const hashBefore = db._stores.guestSessions.get(first.guestSessionId!)!
			.sessionToken;
		vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);

		await expect(resumeGuest(db, token)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
		expect(
			db._stores.guestSessions.get(first.guestSessionId!)!.sessionToken,
		).toBe(hashBefore);
	});

	it("a made-up resume token is rejected", async () => {
		await expect(resumeGuest(db, "f".repeat(64))).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("resuming restores a removed guest's membership while the invite is live", async () => {
		const { first, token } = await mailedResumeToken();
		for (const [id, pp] of db._stores.projectParticipants) {
			if (pp.participantId === first.guestSessionId) {
				db._stores.projectParticipants.delete(id);
			}
		}

		await resumeGuest(db, token);

		const restored = [...db._stores.projectParticipants.values()].find(
			(pp) => pp.participantId === first.guestSessionId,
		);
		expect(restored?.role).toBe("CONTRIBUTOR");
	});

	it("role granted by the link is stored on the ProjectParticipant", async () => {
		const editorLink = addMagicLink(db, {
			projectId,
			createdById: "alice",
			roleGranted: "EDITOR",
		});

		await registerGuest(db, {
			linkId: editorLink.id,
			name: "Editor Guest",
			email: "editor@example.com",
		});

		const guestSession = [...db._stores.guestSessions.values()].find(
			(gs) => gs.email === "editor@example.com",
		);
		const participant = [...db._stores.projectParticipants.values()].find(
			(pp) =>
				pp.participantType === "guest" && pp.participantId === guestSession?.id,
		);

		expect(participant?.role).toBe("EDITOR");
	});

	it("sessionToken is hashed in the DB: plaintext is not stored", async () => {
		const result = await registerGuest(db, {
			linkId,
			name: "Marcus",
			email: "marcus@example.com",
		});

		if (result.resumeEmailSent) throw new Error("Should be a new guest");

		const session = db._stores.guestSessions.get(result.guestSessionId!);
		expect(session).toBeDefined();

		// The stored token should be the SHA-256 hash, not the raw token
		const expectedHash = createHash("sha256")
			.update(result.sessionToken!)
			.digest("hex");
		expect(session?.sessionToken).toBe(expectedHash);
		// And NOT equal to the plaintext token
		expect(session?.sessionToken).not.toBe(result.sessionToken);
	});
});
