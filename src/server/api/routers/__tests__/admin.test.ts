/**
 * Admin router tests: account disable and email verification side effects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = vi.hoisted(() => {
	const db = {
		user: { update: vi.fn() },
		session: { deleteMany: vi.fn() },
		// disableUser runs in a transaction that first locks the active admins.
		$queryRaw: vi.fn(async () => [] as unknown[]),
		$transaction: vi.fn(),
	};
	db.$transaction.mockImplementation(async (cb: (tx: typeof db) => unknown) =>
		cb(db),
	);
	return db;
});

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

vi.mock("~/server/services/audit.service", () => ({
	logEventAsync: vi.fn(),
}));

vi.mock("~/server/mailer", () => ({ sendEmail: vi.fn() }));
vi.mock("~/server/storage", () => ({
	deleteFile: vi.fn(),
	getStorageSize: vi.fn(),
}));
vi.mock("~/server/services/settings", () => ({
	getAppSettings: vi.fn(),
	updateAppSettings: vi.fn(),
}));
vi.mock("~/server/services/ai-access.service", () => ({
	getAiUsageSummary: vi.fn(),
}));
vi.mock("~/server/services/integration.service", () => ({
	IntegrationService: vi.fn(),
}));

const mockMigrate = vi.hoisted(() => vi.fn());
vi.mock("~/server/services/guest-migration.service", () => ({
	migrateGuestDataForVerifiedUser: mockMigrate,
}));

import { createCallerFactory } from "~/server/api/trpc";
import { makeAdminSession } from "~/test/trpc-test-utils";
import { adminRouter } from "../admin";

const createCaller = createCallerFactory(adminRouter);

async function callAndFlush<T>(fn: () => Promise<T>): Promise<T> {
	const promise = fn();
	promise.catch(() => undefined);
	await vi.runAllTimersAsync();
	return promise;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	mockDb.user.update.mockResolvedValue({ username: "target" });
	mockDb.session.deleteMany.mockResolvedValue({ count: 2 });
});

afterEach(() => {
	vi.useRealTimers();
});

describe("admin.disableUser", () => {
	it("marks the user inactive and deletes all of their sessions", async () => {
		const caller = createCaller({
			session: makeAdminSession({ id: "admin-1" }),
			db: mockDb as never,
			headers: new Headers(),
		});

		await callAndFlush(() => caller.disableUser({ userId: "user-2" }));

		expect(mockDb.user.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: "user-2" },
				data: { isActive: false },
			}),
		);
		expect(mockDb.session.deleteMany).toHaveBeenCalledWith({
			where: { userId: "user-2" },
		});
	});

	it("refuses to disable the caller's own account", async () => {
		const caller = createCaller({
			session: makeAdminSession({ id: "admin-1" }),
			db: mockDb as never,
			headers: new Headers(),
		});

		await expect(
			callAndFlush(() => caller.disableUser({ userId: "admin-1" })),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(mockDb.session.deleteMany).not.toHaveBeenCalled();
	});
});

describe("admin email verification", () => {
	function adminCaller() {
		return createCaller({
			session: makeAdminSession({ id: "admin-1" }),
			db: mockDb as never,
			headers: new Headers(),
		});
	}

	it("markEmailVerified runs the deferred guest migration", async () => {
		await callAndFlush(() => adminCaller().markEmailVerified({ userId: "user-2" }));
		expect(mockMigrate).toHaveBeenCalledWith(mockDb, "user-2");
	});

	it("toggleEmailVerification runs it only when verifying", async () => {
		await callAndFlush(() =>
			adminCaller().toggleEmailVerification({ userId: "user-2", verified: false }),
		);
		expect(mockMigrate).not.toHaveBeenCalled();

		await callAndFlush(() =>
			adminCaller().toggleEmailVerification({ userId: "user-2", verified: true }),
		);
		expect(mockMigrate).toHaveBeenCalledWith(mockDb, "user-2");
	});
});
