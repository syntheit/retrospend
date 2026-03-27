/**
 * tRPC Test Utilities
 *
 * Shared helpers for testing tRPC routers. Reduces boilerplate across test files.
 *
 * Usage pattern:
 *   // In your test file (with vi.mock for db and auth already set up):
 *   import { makeSession, callAndFlush } from "~/test/trpc-test-utils"
 *   import { createCallerFactory } from "~/server/api/trpc"
 *   import { myRouter } from "../my-router"
 *
 *   const createCaller = createCallerFactory(myRouter)
 *   const caller = createCaller({ session: makeSession(), db: mockDb, headers: new Headers() })
 *   const result = await callAndFlush(() => caller.someAction())
 */
import { vi } from "vitest";

// ── Session helpers ───────────────────────────────────────────────────────────

export type TestUserOverrides = {
	id?: string;
	name?: string;
	email?: string;
	username?: string | null;
	role?: "USER" | "ADMIN";
	isActive?: boolean;
};

/**
 * Returns a mock session object for a regular authenticated user.
 * Matches the shape that protectedProcedure/adminProcedure expect in ctx.session.
 */
export function makeSession(overrides: TestUserOverrides = {}) {
	return {
		user: {
			id: overrides.id ?? "user-1",
			name: overrides.name ?? "Test User",
			email: overrides.email ?? "test@test.com",
			username: overrides.username ?? null,
			role: overrides.role ?? "USER",
			isActive: overrides.isActive ?? true,
		},
	} as never;
}

/** Returns a mock session for an admin user. */
export function makeAdminSession(overrides: TestUserOverrides = {}) {
	return makeSession({ role: "ADMIN", ...overrides });
}

// ── Timer helpers ─────────────────────────────────────────────────────────────

/**
 * Runs a tRPC procedure call while advancing fake timers.
 *
 * Required because NODE_ENV=test enables timingMiddleware's 100–500 ms delay.
 * Call vi.useFakeTimers() in beforeEach, then wrap procedure calls with this.
 *
 * @example
 *   vi.useFakeTimers()
 *   const result = await callAndFlush(() => caller.myProcedure({ ... }))
 */
export async function callAndFlush<T>(fn: () => Promise<T>): Promise<T> {
	const promise = fn();
	// Suppress the transient unhandled-rejection that fires between promise
	// creation and vi.runAllTimersAsync() settling. The real rejection still
	// propagates through the returned promise.
	promise.catch(() => undefined);
	await vi.runAllTimersAsync();
	return promise;
}

// ── Guest token helpers ───────────────────────────────────────────────────────

import { createHash } from "node:crypto";

/**
 * Hashes a raw guest token the same way guestOrProtectedProcedure does.
 * Use to set up guestSession.findUnique mocks with the correct hashed value.
 *
 * @example
 *   const rawToken = "my-guest-token"
 *   const hashed = hashGuestToken(rawToken)
 *   mockDb.guestSession.findUnique.mockResolvedValue({ sessionToken: hashed, ... })
 *   const headers = new Headers({ "x-guest-token": rawToken })
 */
export function hashGuestToken(rawToken: string): string {
	return createHash("sha256").update(rawToken).digest("hex");
}
