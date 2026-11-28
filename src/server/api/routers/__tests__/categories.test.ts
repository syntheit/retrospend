/**
 * Category names on the tRPC router. What a delete or merge does with the
 * rows and budgets is covered on Postgres (services/category/merge*.pg.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// The write is one money mutation, which appends its event in its own
// transaction; this file mocks Prisma, so the event store is out of scope.
vi.mock("~/server/services/events/scope", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/services/events/scope")>()),
	recordMutationEvent: vi.fn(async () => false),
}));

vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { callAndFlush, makeSession } from "~/test/trpc-test-utils";
import { categoriesRouter } from "../categories";

const createCaller = createCallerFactory(categoriesRouter);
const caller = () =>
	createCaller({
		session: makeSession({ id: "user-1" }),
		db: mockDb as never,
		headers: new Headers(),
	});

const CATEGORY = "clcategory0000000000001";

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	Object.assign(mockDb, createMockDb());
	mockDb.category.delete.mockResolvedValue({ id: CATEGORY });
	// The category being deleted belongs to the caller.
	mockDb.category.findFirst.mockResolvedValue({ id: CATEGORY });
});

afterEach(() => {
	vi.useRealTimers();
});

describe("categories name", () => {
	beforeEach(() => {
		mockDb.category.findMany.mockResolvedValue([{ name: "Food" }]);
		mockDb.category.create.mockResolvedValue({ id: CATEGORY });
	});

	it("refuses a name that is blank once trimmed, before touching the database", async () => {
		for (const name of ["", " ", "\t \n"]) {
			await expect(
				callAndFlush(() => caller().create({ name, color: "teal" })),
			).rejects.toMatchObject({ code: "BAD_REQUEST" });
		}
		await expect(
			callAndFlush(() => caller().create({ name: "a\u0001b", color: "teal" })),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			callAndFlush(() => caller().create({ name: "a\uD800b", color: "teal" })),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(mockDb.category.create).not.toHaveBeenCalled();
	});

	it("a name that differs only by surrounding spaces is a duplicate", async () => {
		await expect(
			callAndFlush(() => caller().create({ name: " Food ", color: "teal" })),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(mockDb.category.create).not.toHaveBeenCalled();
	});

	it("stores the name as typed", async () => {
		await callAndFlush(() =>
			caller().create({ name: " Fuel ", color: "teal" }),
		);
		expect(mockDb.category.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ name: " Fuel " }),
			}),
		);
	});
});
