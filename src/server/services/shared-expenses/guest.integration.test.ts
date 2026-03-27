/**
 * Integration Test Suite 3: Guest Flow
 *
 * Tests magic link validation and guest registration logic.
 * Since the guest router uses DB directly (no separate service class),
 * we test the core validation logic and DB interaction patterns
 * used by the router procedures.
 */

import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

// ── Inline the validateLinkOrThrow logic for direct testing ──────────────────
// (mirrors guest.ts private function exactly)

function validateLinkOrThrow(link: {
	isActive: boolean;
	expiresAt: Date | null;
	maxUses: number | null;
	useCount: number;
}): void {
	if (!link.isActive) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "This invite link is no longer valid",
		});
	}
	if (link.expiresAt !== null && link.expiresAt < new Date()) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "This invite link is no longer valid",
		});
	}
	if (link.maxUses !== null && link.useCount >= link.maxUses) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "This invite link is no longer valid",
		});
	}
}

// ── Inline the guest registration flow for direct testing ─────────────────────
// (mirrors guest.ts register procedure logic without tRPC overhead)

import { createHash, randomBytes } from "node:crypto";

type RegisterGuestResult = {
	existingUser: boolean;
	projectId: string;
	projectName: string;
	role?: string;
	sessionToken?: string;
	guestSessionId?: string;
};

async function registerGuest(
	db: ReturnType<typeof createStatefulDb>,
	input: { linkId: string; name: string; email: string },
): Promise<RegisterGuestResult> {
	const link = await db.magicLink.findUnique({
		where: { id: input.linkId },
		include: { project: true },
	});

	if (!link) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "This invite link is no longer valid",
		});
	}

	validateLinkOrThrow(
		link as {
			isActive: boolean;
			expiresAt: Date | null;
			maxUses: number | null;
			useCount: number;
		},
	);

	const projectId = (link as { projectId: string }).projectId;
	const email = input.email.toLowerCase().trim();

	// Check if email belongs to existing user
	const existingUser = await db.user.findUnique({
		where: { email },
		select: { id: true },
	});

	if (existingUser) {
		await db.projectParticipant.upsert({
			where: {
				projectId_participantType_participantId: {
					projectId,
					participantType: "user",
					participantId: existingUser.id,
				},
			},
			create: {
				projectId,
				participantType: "user",
				participantId: existingUser.id,
				role: (link as { roleGranted: string }).roleGranted,
			},
			update: {},
		});

		await db.magicLink.update({
			where: { id: link.id as string },
			data: { useCount: { increment: 1 } },
		});

		return {
			existingUser: true as const,
			projectId,
			projectName:
				(link as { project?: { name?: string } }).project?.name ?? "Project",
		};
	}

	// Transaction: prevent duplicate guest sessions
	return await (db.$transaction(async (tx) => {
		const existingSession = await tx.guestSession.findFirst({
			where: { email, projectId },
		});

		if (existingSession) {
			const newToken = randomBytes(32).toString("hex");
			const newHashedToken = createHash("sha256")
				.update(newToken)
				.digest("hex");

			await tx.guestSession.update({
				where: { id: existingSession.id },
				data: {
					sessionToken: newHashedToken,
					lastActiveAt: new Date(),
					name: input.name,
				},
			});

			return {
				existingUser: false as const,
				sessionToken: newToken,
				guestSessionId: existingSession.id,
				projectId,
				projectName:
					(link as { project?: { name?: string } }).project?.name ?? "Project",
				role: (link as { roleGranted: string }).roleGranted,
			};
		}

		const rawToken = randomBytes(32).toString("hex");
		const hashedToken = createHash("sha256").update(rawToken).digest("hex");

		const guestSession = await tx.guestSession.create({
			data: {
				name: input.name,
				email,
				magicLinkId: link.id as string,
				projectId,
				sessionToken: hashedToken,
			},
		});

		await tx.projectParticipant.create({
			data: {
				projectId,
				participantType: "guest",
				participantId: guestSession.id,
				role: (link as { roleGranted: string }).roleGranted,
			},
		});

		await tx.magicLink.update({
			where: { id: link.id as string },
			data: { useCount: { increment: 1 } },
		});

		return {
			existingUser: false as const,
			sessionToken: rawToken,
			guestSessionId: guestSession.id,
			projectId,
			projectName:
				(link as { project?: { name?: string } }).project?.name ?? "Project",
			role: (link as { roleGranted: string }).roleGranted,
		};
	}) as Promise<RegisterGuestResult>);
}

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

		expect(result.existingUser).toBe(false);
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

	it("email is lowercased and trimmed during registration", async () => {
		await registerGuest(db, {
			linkId,
			name: "Marcus",
			email: "  Marcus@EXAMPLE.COM  ",
		});

		const session = [...db._stores.guestSessions.values()][0];
		expect(session?.email).toBe("marcus@example.com");
	});

	it("same email re-registers: returns new session token, no duplicate session", async () => {
		await registerGuest(db, {
			linkId,
			name: "Marcus",
			email: "marcus@example.com",
		});

		// Register again with same email+project
		const secondResult = await registerGuest(db, {
			linkId,
			name: "Marcus Updated",
			email: "marcus@example.com",
		});

		expect(secondResult.existingUser).toBe(false);
		expect(secondResult.sessionToken).toBeDefined();

		// Only one guest session should exist
		expect(db._stores.guestSessions.size).toBe(1);
		// Name was updated
		const session = [...db._stores.guestSessions.values()][0];
		expect(session?.name).toBe("Marcus Updated");
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

	it("existing Retrospend user email: adds as full participant, returns existingUser=true", async () => {
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

		// Should return existingUser=true (redirect to login)
		expect(result.existingUser).toBe(true);
		expect(result.projectId).toBe(projectId);

		// No GuestSession created
		expect(db._stores.guestSessions.size).toBe(0);

		// Full user added as ProjectParticipant
		const participants = [...db._stores.projectParticipants.values()];
		const userParticipant = participants.find(
			(pp) =>
				pp.participantType === "user" && pp.participantId === "existing-user-1",
		);
		expect(userParticipant).toBeDefined();
		expect(userParticipant?.role).toBe("CONTRIBUTOR");

		// useCount still incremented even for existing users
		expect(db._stores.magicLinks.get(linkId)?.useCount).toBe(1);
	});

	it("existing user that is already a participant: upsert is a no-op (no duplicate)", async () => {
		// Pre-populate the existing user
		db._stores.users.set("existing-user-1", {
			id: "existing-user-1",
			name: "Alice Regular",
			email: "regular@example.com",
			image: null,
			username: null,
		});

		// Add them as a participant already
		addProjectParticipant(db, {
			projectId,
			participantType: "user",
			participantId: "existing-user-1",
			role: "EDITOR", // higher role than link would grant
		});

		const participantsBefore = db._stores.projectParticipants.size;

		await registerGuest(db, {
			linkId,
			name: "Alice Regular",
			email: "regular@example.com",
		});

		// No new participant record should be created (upsert update={} is a no-op)
		expect(db._stores.projectParticipants.size).toBe(participantsBefore);
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

	it("guest re-registering after token loss gets a fresh valid token", async () => {
		const first = await registerGuest(db, {
			linkId,
			name: "Marcus",
			email: "marcus@example.com",
		});

		const second = await registerGuest(db, {
			linkId,
			name: "Marcus",
			email: "marcus@example.com",
		});

		// Second registration succeeds
		expect(second.existingUser).toBe(false);
		expect(second.guestSessionId).toBe(first.guestSessionId); // Same session
		// But a new token is issued
		expect(second.sessionToken).not.toBe(first.sessionToken);
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

		if (result.existingUser) throw new Error("Should be a new guest");

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
