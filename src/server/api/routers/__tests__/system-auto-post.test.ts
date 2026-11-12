/**
 * system.getAutoPostStatus: admin only, and the shape the admin page reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = vi.hoisted(() => ({
	systemStatus: { findUnique: vi.fn() },
}));

vi.mock("~/env", () => ({
	env: {
		DATABASE_URL: "postgresql://mock",
		NODE_ENV: "test",
		RECURRING_AUTO_POST: "true",
		SIDECAR_URL: "http://localhost:8080",
	},
}));
vi.mock("~/server/db", () => ({
	db: mockDb as never,
	createUserScopedDb: vi.fn(() => mockDb),
}));
vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));
vi.mock("~/server/services/admin-access.service", () => ({
	logAdminProcedure: vi.fn(),
}));
vi.mock("~/server/services/settings", () => ({ getAppSettings: vi.fn() }));
vi.mock("~/server/services/preview", () => ({ forUser: vi.fn() }));

import { createCallerFactory } from "~/server/api/trpc";
import { makeAdminSession, makeSession } from "~/test/trpc-test-utils";
import { systemRouter } from "../system";

const caller = (session: never) =>
	createCallerFactory(systemRouter)({
		session,
		db: mockDb as never,
		headers: new Headers(),
	});

async function callAndFlush<T>(fn: () => Promise<T>): Promise<T> {
	const promise = fn();
	promise.catch(() => undefined);
	await vi.runAllTimersAsync();
	return promise;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-11-12T12:00:00.000Z"));
	vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe("system.getAutoPostStatus", () => {
	it("refuses a member", async () => {
		await expect(
			callAndFlush(() => caller(makeSession()).getAutoPostStatus()),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect(mockDb.systemStatus.findUnique).not.toHaveBeenCalled();
	});

	it("gives an admin the state, the last run and the counts", async () => {
		mockDb.systemStatus.findUnique.mockResolvedValue({
			value: {
				lastRun: "2026-11-12T11:50:00.000Z",
				posted: 3,
				raced: 0,
				missingRate: 0,
				retry: 0,
				capped: 0,
				failed: 2,
			},
		});
		const result = await callAndFlush(() =>
			caller(makeAdminSession()).getAutoPostStatus(),
		);
		expect(result).toEqual({
			state: "failing",
			offReason: null,
			lastRun: "2026-11-12T11:50:00.000Z",
			counts: { posted: 3, missingRate: 0, capped: 0, failed: 2 },
		});
	});
});
