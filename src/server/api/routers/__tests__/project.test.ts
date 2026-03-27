/**
 * Project Authorization Tests
 *
 * Tests two layers:
 * 1. requireProjectRole() directly - the core gate used by all project mutations
 * 2. Key inline authorization checks in the project router that sit ON TOP of requireProjectRole
 *    (shadow profile ownership, duplicate prevention, creator protection)
 *
 * Router tests use a full tRPC caller with all router dependencies mocked.
 */
import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks (hoisted) ─────────────────────────────────────────────────────────
//
// vi.mock factories run before const/let declarations. Use vi.hoisted() for
// variables referenced inside factory functions.

const mockDb = vi.hoisted(() => ({
	user: { findUnique: vi.fn() },
	project: {
		findUniqueOrThrow: vi.fn(),
		findUnique: vi.fn(),
		findMany: vi.fn(),
		delete: vi.fn().mockResolvedValue({}),
	},
	projectParticipant: {
		findUnique: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
	},
	shadowProfile: { findUnique: vi.fn() },
	guestSession: { findUnique: vi.fn(), update: vi.fn() },
	sharedTransaction: { count: vi.fn(), aggregate: vi.fn() },
	billingPeriod: { create: vi.fn() },
	auditLog: { create: vi.fn() },
	magicLink: { create: vi.fn() },
	$transaction: vi.fn(),
	$executeRaw: vi.fn(),
}));

const mockRequireProjectRole = vi.hoisted(() => vi.fn());

vi.mock("~/env", () => ({
	env: {
		DATABASE_URL: "postgresql://mock",
		NODE_ENV: "test",
		BETTER_AUTH_SECRET: "secret",
		NEXT_PUBLIC_APP_URL: "http://localhost:3000",
	},
}));

vi.mock("~/server/db", () => ({
	db: mockDb as never,
	createUserScopedDb: vi.fn(() => mockDb),
}));

vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));

vi.mock("~/server/storage", () => ({
	getImageUrl: vi.fn(() => null),
}));

vi.mock("~/server/services/notifications", () => ({
	createNotification: vi.fn().mockResolvedValue(undefined),
	resolveParticipantName: vi.fn().mockResolvedValue("Test User"),
}));

vi.mock("~/server/services/shared-expenses/audit-log", () => ({
	logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/server/api/routers/billingPeriod", () => ({
	computePeriodLabel: vi.fn().mockReturnValue("March 2026"),
}));

vi.mock("~/server/services/shared-expenses/group-settlement", () => ({
	computeSettlementPlan: vi.fn().mockResolvedValue([]),
}));

vi.mock("~/server/services/shared-expenses/project-permissions", () => ({
	requireProjectRole: mockRequireProjectRole,
	assertCanModifyTransaction: vi.fn(),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────

import { createCallerFactory } from "~/server/api/trpc";
import { projectRouter } from "../project";

const createCaller = createCallerFactory(projectRouter);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOrganizerSession(userId = "organizer-1") {
	return {
		user: {
			id: userId,
			role: "USER",
			email: "org@test.com",
			name: "Organizer",
			isActive: true,
		},
	} as never;
}

async function callAndFlush<T>(fn: () => Promise<T>): Promise<T> {
	const promise = fn();
	// Suppress the transient unhandled-rejection that can fire between the
	// promise creation and vi.runAllTimersAsync() resolving. The real
	// rejection still propagates through the returned promise.
	promise.catch(() => undefined);
	await vi.runAllTimersAsync();
	return promise;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();

	// Active user by default
	mockDb.user.findUnique.mockResolvedValue({ isActive: true });
	// $transaction runs callback with mock tx
	mockDb.$transaction.mockImplementation(
		async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb),
	);
	mockDb.$executeRaw.mockResolvedValue(1);

	// requireProjectRole resolves with ORGANIZER role by default
	mockRequireProjectRole.mockResolvedValue({
		id: "pp-1",
		role: "ORGANIZER",
		projectId: "proj-1",
		participantType: "user",
		participantId: "organizer-1",
		joinedAt: new Date(),
	});
});

afterEach(() => {
	vi.useRealTimers();
});

// ── 1. requireProjectRole (tested directly, no tRPC overhead) ────────────────

describe("requireProjectRole (direct)", () => {
	// We test the real function but need its actual import, not the mock
	// Import separately before the mock is applied - use a fresh module
	it("throws NOT_FOUND when participant does not exist in project", async () => {
		// We can test this through a fresh mock DB without going through tRPC
		const { requireProjectRole: realFn } = await vi.importActual<
			typeof import("~/server/services/shared-expenses/project-permissions")
		>("~/server/services/shared-expenses/project-permissions");

		const localDb = {
			projectParticipant: { findUnique: vi.fn().mockResolvedValue(null) },
		};

		await expect(
			realFn(localDb as never, "proj-1", "user", "user-1", "VIEWER"),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("throws FORBIDDEN when participant role is insufficient", async () => {
		const { requireProjectRole: realFn } = await vi.importActual<
			typeof import("~/server/services/shared-expenses/project-permissions")
		>("~/server/services/shared-expenses/project-permissions");

		const localDb = {
			projectParticipant: {
				findUnique: vi.fn().mockResolvedValue({
					id: "pp-1",
					role: "VIEWER",
					projectId: "proj-1",
					participantType: "user",
					participantId: "user-1",
				}),
			},
		};

		await expect(
			realFn(localDb as never, "proj-1", "user", "user-1", "ORGANIZER"),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("returns participant when role meets minimum requirement", async () => {
		const { requireProjectRole: realFn } = await vi.importActual<
			typeof import("~/server/services/shared-expenses/project-permissions")
		>("~/server/services/shared-expenses/project-permissions");

		const participant = {
			id: "pp-1",
			role: "ORGANIZER",
			projectId: "proj-1",
			participantType: "user",
			participantId: "user-1",
		};
		const localDb = {
			projectParticipant: {
				findUnique: vi.fn().mockResolvedValue(participant),
			},
		};

		const result = await realFn(
			localDb as never,
			"proj-1",
			"user",
			"user-1",
			"EDITOR",
		);
		expect(result).toEqual(participant);
	});

	it("CONTRIBUTOR satisfies CONTRIBUTOR minimum but not EDITOR", async () => {
		const { requireProjectRole: realFn } = await vi.importActual<
			typeof import("~/server/services/shared-expenses/project-permissions")
		>("~/server/services/shared-expenses/project-permissions");

		const localDb = {
			projectParticipant: {
				findUnique: vi.fn().mockResolvedValue({ id: "pp-1", role: "CONTRIBUTOR" }),
			},
		};

		await expect(
			realFn(localDb as never, "proj-1", "user", "user-1", "EDITOR"),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

// ── 2. project.addParticipant (through router caller) ────────────────────────

describe("project.addParticipant", () => {
	it("throws FORBIDDEN when adding a shadow profile owned by another user", async () => {
		// Shadow profile exists but was created by a different user
		mockDb.shadowProfile.findUnique.mockResolvedValue({
			id: "shadow-1",
			createdById: "other-user", // NOT the organizer
		});
		mockDb.projectParticipant.findUnique.mockResolvedValue(null); // not a duplicate

		const caller = createCaller({
			session: makeOrganizerSession("organizer-1"),
			db: mockDb as never,
			headers: new Headers(),
		});

		await expect(
			callAndFlush(() =>
				caller.addParticipant({
					projectId: "proj-1",
					participantType: "shadow",
					participantId: "shadow-1",
					role: "CONTRIBUTOR",
				}),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("throws NOT_FOUND when shadow profile does not exist", async () => {
		mockDb.shadowProfile.findUnique.mockResolvedValue(null);

		const caller = createCaller({
			session: makeOrganizerSession(),
			db: mockDb as never,
			headers: new Headers(),
		});

		await expect(
			callAndFlush(() =>
				caller.addParticipant({
					projectId: "proj-1",
					participantType: "shadow",
					participantId: "ghost-shadow",
					role: "CONTRIBUTOR",
				}),
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("throws CONFLICT when participant is already in project", async () => {
		// Existing participant record
		mockDb.projectParticipant.findUnique.mockResolvedValue({
			id: "pp-existing",
			role: "VIEWER",
		});

		const caller = createCaller({
			session: makeOrganizerSession(),
			db: mockDb as never,
			headers: new Headers(),
		});

		await expect(
			callAndFlush(() =>
				caller.addParticipant({
					projectId: "proj-1",
					participantType: "user",
					participantId: "already-in-project",
					role: "CONTRIBUTOR",
				}),
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});
});

// ── 3. project.updateParticipantRole ─────────────────────────────────────────

describe("project.updateParticipantRole", () => {
	it("throws FORBIDDEN when organizer tries to change their own role", async () => {
		const caller = createCaller({
			session: makeOrganizerSession("organizer-1"),
			db: mockDb as never,
			headers: new Headers(),
		});

		await expect(
			callAndFlush(() =>
				caller.updateParticipantRole({
					projectId: "proj-1",
					participantType: "user",
					participantId: "organizer-1", // same as session user
					role: "EDITOR",
				}),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("throws FORBIDDEN when trying to demote the project creator below ORGANIZER", async () => {
		// Target participant is the project creator
		mockDb.projectParticipant.findUnique.mockResolvedValue({
			id: "pp-creator",
			role: "ORGANIZER",
			participantType: "user",
			participantId: "creator-user",
		});
		mockDb.project.findUniqueOrThrow.mockResolvedValue({
			id: "proj-1",
			createdById: "creator-user", // target IS the creator
		});

		const caller = createCaller({
			session: makeOrganizerSession("organizer-1"),
			db: mockDb as never,
			headers: new Headers(),
		});

		await expect(
			callAndFlush(() =>
				caller.updateParticipantRole({
					projectId: "proj-1",
					participantType: "user",
					participantId: "creator-user",
					role: "EDITOR", // demoting creator below ORGANIZER
				}),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

// ── 4. project.removeParticipant ─────────────────────────────────────────────

describe("project.removeParticipant", () => {
	it("throws FORBIDDEN when trying to remove the project creator", async () => {
		mockDb.project.findUniqueOrThrow.mockResolvedValue({
			id: "proj-1",
			createdById: "creator-user",
		});

		const caller = createCaller({
			session: makeOrganizerSession("organizer-1"),
			db: mockDb as never,
			headers: new Headers(),
		});

		await expect(
			callAndFlush(() =>
				caller.removeParticipant({
					projectId: "proj-1",
					participantType: "user",
					participantId: "creator-user", // the creator
				}),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("throws FORBIDDEN when called by a non-organizer (requireProjectRole rejects)", async () => {
		mockRequireProjectRole.mockRejectedValue(
			new TRPCError({ code: "FORBIDDEN" }),
		);

		const caller = createCaller({
			session: makeOrganizerSession("viewer-1"),
			db: mockDb as never,
			headers: new Headers(),
		});

		await expect(
			callAndFlush(() =>
				caller.removeParticipant({
					projectId: "proj-1",
					participantType: "user",
					participantId: "member-1",
				}),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("valid removal by organizer succeeds", async () => {
		mockDb.project.findUniqueOrThrow.mockResolvedValue({
			id: "proj-1",
			createdById: "creator-user", // target is NOT the creator
		});
		mockDb.projectParticipant.findUnique.mockResolvedValue({
			id: "pp-member",
			role: "CONTRIBUTOR",
			participantType: "user",
			participantId: "member-1",
		});
		mockDb.projectParticipant.delete.mockResolvedValue({});

		const caller = createCaller({
			session: makeOrganizerSession("organizer-1"),
			db: mockDb as never,
			headers: new Headers(),
		});

		const result = await callAndFlush(() =>
			caller.removeParticipant({
				projectId: "proj-1",
				participantType: "user",
				participantId: "member-1", // not the creator
			}),
		);
		expect(result).toEqual({ success: true });
	});
});

// ── 5. project.createMagicLink ────────────────────────────────────────────────

describe("project.createMagicLink", () => {
	it("throws BAD_REQUEST when roleGranted is ORGANIZER", async () => {
		const caller = createCaller({
			session: makeOrganizerSession("organizer-1"),
			db: mockDb as never,
			headers: new Headers(),
		});

		await expect(
			callAndFlush(() =>
				caller.createMagicLink({
					projectId: "proj-1",
					roleGranted: "ORGANIZER",
				}),
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("valid magic link creation returns a URL with the link id", async () => {
		const linkId = "550e8400-e29b-41d4-a716-446655440000"; // valid UUID
		mockDb.magicLink.create.mockResolvedValue({
			id: linkId,
			projectId: "proj-1",
			roleGranted: "CONTRIBUTOR",
			createdById: "organizer-1",
			expiresAt: null,
			maxUses: null,
			uses: 0,
			isActive: true,
			createdAt: new Date(),
		});

		const caller = createCaller({
			session: makeOrganizerSession("organizer-1"),
			db: mockDb as never,
			headers: new Headers(),
		});

		const result = await callAndFlush(() =>
			caller.createMagicLink({
				projectId: "proj-1",
				roleGranted: "CONTRIBUTOR",
			}),
		);

		expect(result.id).toBe(linkId);
		expect(result.url).toContain(linkId);
	});
});

// ── 6. project.delete ─────────────────────────────────────────────────────────

describe("project.delete", () => {
	it("throws FORBIDDEN when a non-creator organizer tries to delete", async () => {
		mockDb.project.findUniqueOrThrow.mockResolvedValue({
			id: "proj-1",
			createdById: "creator-user", // different from the caller
			name: "Test Project",
		});

		const caller = createCaller({
			session: makeOrganizerSession("organizer-1"), // NOT the creator
			db: mockDb as never,
			headers: new Headers(),
		});

		await expect(
			callAndFlush(() => caller.delete({ id: "proj-1" })),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("creator can delete their own project", async () => {
		mockDb.project.findUniqueOrThrow.mockResolvedValue({
			id: "proj-1",
			createdById: "organizer-1", // same as caller
			name: "Test Project",
		});
		mockDb.project.delete.mockResolvedValue({});

		const caller = createCaller({
			session: makeOrganizerSession("organizer-1"),
			db: mockDb as never,
			headers: new Headers(),
		});

		const result = await callAndFlush(() => caller.delete({ id: "proj-1" }));
		expect(result).toEqual({ success: true });
		expect(mockDb.project.delete).toHaveBeenCalledWith({
			where: { id: "proj-1" },
		});
	});
});
