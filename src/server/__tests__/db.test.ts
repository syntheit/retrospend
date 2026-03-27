/**
 * Tests for createUserScopedDb - the RLS security foundation.
 *
 * Verifies the MECHANISM: set_config is called, results are returned correctly.
 * True RLS enforcement (user A cannot read user B's data) requires a real
 * PostgreSQL with policies - that is Phase 5 / E2E territory.
 *
 * Mocking strategy: replace PrismaClient, pg.Pool, and @prisma/adapter-pg so the
 * module loads without a real DB connection. vi.hoisted() ensures mock variables
 * are initialized before vi.mock factories run (which are hoisted before imports).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── vi.hoisted: must run before vi.mock factories & imports ─────────────────
//
// vi.mock factories are hoisted to the top of the file and execute BEFORE any
// const/let declarations in the module body. vi.hoisted() runs even earlier.

const { mockPrismaInstance, mockTransaction, mockExecuteRaw } = vi.hoisted(() => {
	const mockTransaction = vi.fn();
	const mockExecuteRaw = vi.fn();
	const mockPrismaInstance = {
		$extends: vi.fn(),
		$transaction: mockTransaction,
		$executeRaw: mockExecuteRaw,
	};
	return { mockPrismaInstance, mockTransaction, mockExecuteRaw };
});

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("~/env", () => ({
	env: { DATABASE_URL: "postgresql://mock:5432/mock", NODE_ENV: "test" },
}));

vi.mock("~prisma", () => ({
	// Regular function so `new PrismaClient(adapter)` works
	PrismaClient: vi.fn(function () {
		return mockPrismaInstance;
	}),
}));

vi.mock("pg", () => ({
	Pool: vi.fn(function () {
		return {};
	}),
}));

vi.mock("@prisma/adapter-pg", () => ({
	PrismaPg: vi.fn(function () {
		return {};
	}),
}));

// ── Import under test (after mocks) ────────────────────────────────────────

import { createUserScopedDb } from "../db";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Configures mockPrismaInstance.$extends to:
 * 1. Capture the $allOperations hook provided by createUserScopedDb
 * 2. Return a fake "extended" db whose model methods invoke the hook
 */
function setupExtendsMock(queryResult: unknown = ["result"]) {
	type Hook = (opts: {
		args: unknown;
		query: (a: unknown) => Promise<unknown>;
	}) => Promise<unknown>;

	let capturedHook: Hook;

	const fakeExtendedDb = {
		user: {
			findMany: (args: unknown) =>
				capturedHook({ args, query: () => Promise.resolve(queryResult) }),
			findFirst: (args: unknown) =>
				capturedHook({ args, query: () => Promise.resolve(queryResult) }),
		},
	};

	mockPrismaInstance.$extends.mockImplementation(
		(ext: { query: { $allModels: { $allOperations: Hook } } }) => {
			capturedHook = ext.query.$allModels.$allOperations;
			return fakeExtendedDb;
		},
	);

	return fakeExtendedDb;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("createUserScopedDb", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// $transaction executes all ops and returns their results as an array
		mockTransaction.mockImplementation(async (ops: Promise<unknown>[]) =>
			Promise.all(ops.map((op) => Promise.resolve(op))),
		);

		// $executeRaw is called as a tagged template literal - return a resolved Promise
		mockExecuteRaw.mockReturnValue(Promise.resolve(1));
	});

	it("calls db.$extends with a query extension containing $allOperations", () => {
		setupExtendsMock();
		createUserScopedDb("user-1");

		expect(mockPrismaInstance.$extends).toHaveBeenCalledTimes(1);
		const [ext] = mockPrismaInstance.$extends.mock.calls[0] as [
			{ query: { $allModels: { $allOperations: unknown } } },
		];
		expect(typeof ext.query.$allModels.$allOperations).toBe("function");
	});

	it("returns a truthy extended db object", () => {
		setupExtendsMock();
		const userDb = createUserScopedDb("user-1");
		expect(userDb).toBeTruthy();
	});

	it("wraps each query in a $transaction call", async () => {
		const fakeDb = setupExtendsMock(["user1"]);
		const userDb = createUserScopedDb("user-1") as typeof fakeDb;
		await userDb.user.findMany({});
		expect(mockTransaction).toHaveBeenCalledTimes(1);
	});

	it("$transaction receives exactly 2 operations (set_config + actual query)", async () => {
		const fakeDb = setupExtendsMock(["user1"]);
		const userDb = createUserScopedDb("user-1") as typeof fakeDb;
		await userDb.user.findMany({});

		const [ops] = mockTransaction.mock.calls[0] as [unknown[]];
		expect(ops).toHaveLength(2);
	});

	it("returns the query result (second element from $transaction array)", async () => {
		const fakeDb = setupExtendsMock(["user1", "user2"]);
		const userDb = createUserScopedDb("user-1") as typeof fakeDb;
		const result = await userDb.user.findMany({});
		expect(result).toEqual(["user1", "user2"]);
	});

	it("multiple sequential calls each get their own $transaction", async () => {
		const fakeDb = setupExtendsMock(["result"]);
		const userDb = createUserScopedDb("user-1") as typeof fakeDb;
		await userDb.user.findMany({});
		await userDb.user.findFirst({});
		expect(mockTransaction).toHaveBeenCalledTimes(2);
	});

	it("query errors propagate out of the hook", async () => {
		type Hook = (opts: {
			args: unknown;
			query: () => Promise<never>;
		}) => Promise<unknown>;

		let capturedHook: Hook;

		const failingDb = {
			user: {
				findMany: (args: unknown) =>
					capturedHook({
						args,
						query: () => Promise.reject(new Error("DB error")),
					}),
			},
		};

		mockPrismaInstance.$extends.mockImplementation(
			(ext: { query: { $allModels: { $allOperations: Hook } } }) => {
				capturedHook = ext.query.$allModels.$allOperations;
				return failingDb;
			},
		);

		const userDb = createUserScopedDb("user-1") as typeof failingDb;
		await expect(userDb.user.findMany({})).rejects.toThrow("DB error");
	});
});
