/**
 * Imported expenses (and the sidecar's) have cuid ids, not uuids: the
 * delete procedure takes any id and still only touches your own rows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "~/test/mock-db";

const mockDb = vi.hoisted(() => ({}) as ReturnType<typeof createMockDb>);

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

import { createCallerFactory } from "~/server/api/trpc";
import { makeSession } from "~/test/trpc-test-utils";
import { expenseRouter } from "../expense";

const caller = () =>
	createCallerFactory(expenseRouter)({
		session: makeSession({ id: "user-1" }),
		db: mockDb as never,
		headers: new Headers(),
	});

beforeEach(() => {
	vi.clearAllMocks();
	Object.assign(mockDb, createMockDb());
});

describe("expense ids", () => {
	it("still refuses an empty or oversized id", async () => {
		await expect(
			caller().deleteExpense({ id: "x".repeat(65) }),
		).rejects.toThrow();
	});
});
