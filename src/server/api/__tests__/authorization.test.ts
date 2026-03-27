/**
 * tRPC Authorization Smoke Tests
 *
 * Verifies that protectedProcedure, adminProcedure, and guestOrProtectedProcedure
 * enforce auth rules correctly. Uses minimal test routers to avoid mocking every
 * router dependency in the full appRouter.
 *
 * The timing middleware adds an artificial 100–500 ms delay when NODE_ENV !== "production".
 * Tests use vi.useFakeTimers() + vi.runAllTimersAsync() to flush it instantly.
 */
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks (hoisted) ─────────────────────────────────────────────────────────
//
// vi.mock factories are hoisted to the top of the file and run before any
// const/let declarations. Use vi.hoisted() to declare variables that need to
// be available inside those factories.

const mockDb = vi.hoisted(() => ({
	user: { findUnique: vi.fn() },
	guestSession: {
		findUnique: vi.fn(),
		update: vi.fn().mockResolvedValue({}),
	},
}));

vi.mock("~/env", () => ({
	env: {
		DATABASE_URL: "postgresql://mock:5432/mock",
		NODE_ENV: "test",
		BETTER_AUTH_SECRET: "test-secret",
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

// ── Imports (after mocks) ───────────────────────────────────────────────────

import {
	adminProcedure,
	assertGuestProjectScope,
	createCallerFactory,
	createTRPCRouter,
	guestOrProtectedProcedure,
	protectedProcedure,
} from "~/server/api/trpc";
import { z } from "zod";

// ── Minimal test router ─────────────────────────────────────────────────────

const testRouter = createTRPCRouter({
	protectedAction: protectedProcedure.query(() => "ok" as const),
	adminAction: adminProcedure.query(() => "ok" as const),
	guestAction: guestOrProtectedProcedure.query(() => "ok" as const),
	// Scoped action: the procedure enforces guest project scope
	scopedAction: guestOrProtectedProcedure
		.input(z.object({ projectId: z.string() }))
		.query(({ ctx, input }) => {
			assertGuestProjectScope(ctx.participant, input.projectId);
			return "ok" as const;
		}),
});

const createTestCaller = createCallerFactory(testRouter);

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(overrides: { role?: string; id?: string } = {}) {
	return {
		user: {
			id: overrides.id ?? "user-1",
			role: overrides.role ?? "USER",
			email: "test@test.com",
			name: "Test User",
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

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
	// Default: user exists and is active (overridden per-test when needed)
	mockDb.user.findUnique.mockResolvedValue({ isActive: true });
	mockDb.guestSession.update.mockResolvedValue({});
});

afterEach(() => {
	vi.useRealTimers();
});

// ── protectedProcedure ───────────────────────────────────────────────────────

describe("protectedProcedure", () => {
	it("throws UNAUTHORIZED when session is null", async () => {
		const caller = createTestCaller({
			session: null,
			db: mockDb as never,
			headers: new Headers(),
		});
		await expect(callAndFlush(() => caller.protectedAction())).rejects.toThrow(
			TRPCError,
		);
	});

	it("throws UNAUTHORIZED when session.user is undefined", async () => {
		const caller = createTestCaller({
			session: { user: undefined } as never,
			db: mockDb as never,
			headers: new Headers(),
		});
		await expect(callAndFlush(() => caller.protectedAction())).rejects.toThrow(
			TRPCError,
		);
	});

	it("throws UNAUTHORIZED when user.isActive is false", async () => {
		mockDb.user.findUnique.mockResolvedValue({ isActive: false });
		const caller = createTestCaller({
			session: makeSession(),
			db: mockDb as never,
			headers: new Headers(),
		});
		await expect(callAndFlush(() => caller.protectedAction())).rejects.toThrow(
			TRPCError,
		);
	});

	it("throws UNAUTHORIZED when user does not exist in DB", async () => {
		mockDb.user.findUnique.mockResolvedValue(null);
		const caller = createTestCaller({
			session: makeSession(),
			db: mockDb as never,
			headers: new Headers(),
		});
		await expect(callAndFlush(() => caller.protectedAction())).rejects.toThrow(
			TRPCError,
		);
	});

	it("succeeds for active user with valid session", async () => {
		const caller = createTestCaller({
			session: makeSession(),
			db: mockDb as never,
			headers: new Headers(),
		});
		const result = await callAndFlush(() => caller.protectedAction());
		expect(result).toBe("ok");
	});
});

// ── adminProcedure ───────────────────────────────────────────────────────────

describe("adminProcedure", () => {
	it("throws UNAUTHORIZED when session is null", async () => {
		const caller = createTestCaller({
			session: null,
			db: mockDb as never,
			headers: new Headers(),
		});
		await expect(callAndFlush(() => caller.adminAction())).rejects.toThrow(
			TRPCError,
		);
	});

	it("throws UNAUTHORIZED when role is USER", async () => {
		const caller = createTestCaller({
			session: makeSession({ role: "USER" }),
			db: mockDb as never,
			headers: new Headers(),
		});
		await expect(callAndFlush(() => caller.adminAction())).rejects.toThrow(
			TRPCError,
		);
	});

	it("throws UNAUTHORIZED when role is undefined", async () => {
		const caller = createTestCaller({
			session: makeSession({ role: undefined }),
			db: mockDb as never,
			headers: new Headers(),
		});
		await expect(callAndFlush(() => caller.adminAction())).rejects.toThrow(
			TRPCError,
		);
	});

	it("succeeds for ADMIN role", async () => {
		const caller = createTestCaller({
			session: makeSession({ role: "ADMIN" }),
			db: mockDb as never,
			headers: new Headers(),
		});
		const result = await callAndFlush(() => caller.adminAction());
		expect(result).toBe("ok");
	});
});

// ── guestOrProtectedProcedure ────────────────────────────────────────────────

describe("guestOrProtectedProcedure", () => {
	it("succeeds for valid active user session", async () => {
		const caller = createTestCaller({
			session: makeSession(),
			db: mockDb as never,
			headers: new Headers(),
		});
		const result = await callAndFlush(() => caller.guestAction());
		expect(result).toBe("ok");
	});

	it("throws UNAUTHORIZED when no session AND no guest token", async () => {
		const caller = createTestCaller({
			session: null,
			db: mockDb as never,
			headers: new Headers(),
		});
		await expect(callAndFlush(() => caller.guestAction())).rejects.toThrow(
			TRPCError,
		);
	});

	it("succeeds for valid guest token with active session", async () => {
		const rawToken = "valid-guest-token";
		const hashedToken = createHash("sha256").update(rawToken).digest("hex");

		mockDb.guestSession.findUnique.mockResolvedValue({
			id: "guest-session-1",
			sessionToken: hashedToken,
			projectId: "proj-1",
			name: "Guest",
			email: null,
			lastActiveAt: new Date(), // recently active
		});

		const headers = new Headers({ "x-guest-token": rawToken });
		const caller = createTestCaller({
			session: null,
			db: mockDb as never,
			headers,
		});
		const result = await callAndFlush(() => caller.guestAction());
		expect(result).toBe("ok");
	});

	it("throws UNAUTHORIZED when guest token is invalid (not found in DB)", async () => {
		mockDb.guestSession.findUnique.mockResolvedValue(null);
		const headers = new Headers({ "x-guest-token": "invalid-token" });
		const caller = createTestCaller({
			session: null,
			db: mockDb as never,
			headers,
		});
		await expect(callAndFlush(() => caller.guestAction())).rejects.toThrow(
			TRPCError,
		);
	});

	it("throws UNAUTHORIZED when guest session is expired (>90 days inactive)", async () => {
		const rawToken = "old-guest-token";
		const hashedToken = createHash("sha256").update(rawToken).digest("hex");
		const ninetyOneDaysAgo = new Date(
			Date.now() - 91 * 24 * 60 * 60 * 1000,
		);

		mockDb.guestSession.findUnique.mockResolvedValue({
			id: "guest-session-old",
			sessionToken: hashedToken,
			projectId: "proj-1",
			name: "Old Guest",
			email: null,
			lastActiveAt: ninetyOneDaysAgo,
		});

		const headers = new Headers({ "x-guest-token": rawToken });
		const caller = createTestCaller({
			session: null,
			db: mockDb as never,
			headers,
		});
		await expect(callAndFlush(() => caller.guestAction())).rejects.toThrow(
			TRPCError,
		);
	});

	it("guest session within 90 days is not expired", async () => {
		const rawToken = "recent-guest-token";
		const hashedToken = createHash("sha256").update(rawToken).digest("hex");
		const eightyNineDaysAgo = new Date(
			Date.now() - 89 * 24 * 60 * 60 * 1000,
		);

		mockDb.guestSession.findUnique.mockResolvedValue({
			id: "guest-session-recent",
			sessionToken: hashedToken,
			projectId: "proj-1",
			name: "Recent Guest",
			email: null,
			lastActiveAt: eightyNineDaysAgo,
		});

		const headers = new Headers({ "x-guest-token": rawToken });
		const caller = createTestCaller({
			session: null,
			db: mockDb as never,
			headers,
		});
		const result = await callAndFlush(() => caller.guestAction());
		expect(result).toBe("ok");
	});

	it("inactive user falls through to guest token check", async () => {
		// When the user in the session is inactive, the middleware falls through to
		// the guest token path. With no guest token, it throws UNAUTHORIZED.
		mockDb.user.findUnique.mockResolvedValue({ isActive: false });
		const caller = createTestCaller({
			session: makeSession(),
			db: mockDb as never,
			headers: new Headers(), // no guest token
		});
		await expect(callAndFlush(() => caller.guestAction())).rejects.toThrow(
			TRPCError,
		);
	});

	it("guest calling a procedure outside their projectScope throws FORBIDDEN", async () => {
		const rawToken = "scoped-guest-token";
		const hashedToken = createHash("sha256").update(rawToken).digest("hex");

		// Guest is registered for project "proj-A"
		mockDb.guestSession.findUnique.mockResolvedValue({
			id: "guest-session-scoped",
			sessionToken: hashedToken,
			projectId: "proj-A",
			name: "Scoped Guest",
			email: null,
			lastActiveAt: new Date(),
		});

		const headers = new Headers({ "x-guest-token": rawToken });
		const caller = createTestCaller({
			session: null,
			db: mockDb as never,
			headers,
		});

		// Calling with projectId "proj-B" violates the guest's scope
		await expect(
			callAndFlush(() => caller.scopedAction({ projectId: "proj-B" })),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("guest calling a procedure within their projectScope succeeds", async () => {
		const rawToken = "scoped-guest-token-ok";
		const hashedToken = createHash("sha256").update(rawToken).digest("hex");

		mockDb.guestSession.findUnique.mockResolvedValue({
			id: "guest-session-ok",
			sessionToken: hashedToken,
			projectId: "proj-A",
			name: "Scoped Guest",
			email: null,
			lastActiveAt: new Date(),
		});

		const headers = new Headers({ "x-guest-token": rawToken });
		const caller = createTestCaller({
			session: null,
			db: mockDb as never,
			headers,
		});

		const result = await callAndFlush(() =>
			caller.scopedAction({ projectId: "proj-A" }),
		);
		expect(result).toBe("ok");
	});
});
