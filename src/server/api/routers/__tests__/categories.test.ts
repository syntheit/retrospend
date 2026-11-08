/**
 * Deleting a category never leaves its budgets behind as global budgets
 * (batch 4, bug 2).
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
const REPLACEMENT = "clcategory0000000000002";

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

function budgetWrites() {
	return {
		moved: mockDb.budget.updateMany.mock.calls.map((c) => c[0]),
		deleted: mockDb.budget.deleteMany.mock.calls.map((c) => c[0]),
	};
}

describe("categories.delete", () => {
	it("reassigning to uncategorized deletes the category's budgets", async () => {
		mockDb.expense.count.mockResolvedValue(3);

		await callAndFlush(() =>
			caller().delete({ id: CATEGORY, reassignToUncategorized: true }),
		);

		const { moved, deleted } = budgetWrites();
		expect(moved).toEqual([]);
		expect(deleted).toEqual([
			{ where: { categoryId: CATEGORY, userId: "user-1" } },
		]);
		expect(mockDb.expense.updateMany).toHaveBeenCalledWith({
			where: { categoryId: CATEGORY, userId: "user-1" },
			data: { categoryId: null },
		});
	});

	it("a category without expenses takes its budgets with it", async () => {
		mockDb.expense.count.mockResolvedValue(0);

		await callAndFlush(() => caller().delete({ id: CATEGORY }));

		const { moved, deleted } = budgetWrites();
		expect(moved).toEqual([]);
		expect(deleted).toEqual([
			{ where: { categoryId: CATEGORY, userId: "user-1" } },
		]);
		expect(mockDb.category.delete).toHaveBeenCalled();
	});

	it("a replacement category receives the budgets", async () => {
		mockDb.expense.count.mockResolvedValue(2);
		mockDb.category.findFirst.mockResolvedValue({ id: REPLACEMENT });
		mockDb.budget.findMany.mockResolvedValue([]);

		await callAndFlush(() =>
			caller().delete({ id: CATEGORY, replacementCategoryId: REPLACEMENT }),
		);

		const { moved } = budgetWrites();
		expect(moved).toEqual([
			{
				where: { categoryId: CATEGORY, userId: "user-1" },
				data: { categoryId: REPLACEMENT },
			},
		]);
	});
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
