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

const { mockPrismaInstance, mockTransaction, mockExecuteRaw } = vi.hoisted(
	() => {
		const mockTransaction = vi.fn();
		const mockExecuteRaw = vi.fn();
		const mockPrismaInstance = {
			$extends: vi.fn(),
			$transaction: mockTransaction,
			$executeRaw: mockExecuteRaw,
			$queryRaw: vi.fn(),
		};
		// The slot extends the base for the global client at load and for each
		// user's crypto client, and a scoped client extends its crypto client
		// again with the RLS batch. Until a test installs its own
		// implementation, an extension returns the instance itself.
		mockPrismaInstance.$extends.mockImplementation(() => mockPrismaInstance);
		return { mockPrismaInstance, mockTransaction, mockExecuteRaw };
	},
);

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

type Extension = {
	name?: string;
	query: { $allModels: { $allOperations: unknown } };
};

const extensionCalls = () =>
	mockPrismaInstance.$extends.mock.calls.map(([ext]) => ext as Extension);
/** The RLS batch extensions: every extension but the slot's. */
const rlsExtensions = () =>
	extensionCalls().filter((ext) => ext.name !== "text-slot");

/**
 * Configures mockPrismaInstance.$extends to:
 * 1. Pass the slot's extension through (the crypto client is the instance)
 * 2. Capture the $allOperations hook of the RLS batch
 * 3. Return a fake "extended" db whose model methods invoke the hook
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
		(ext: {
			name?: string;
			query: { $allModels: { $allOperations: Hook } };
		}) => {
			if (ext.name === "text-slot") return mockPrismaInstance;
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

	it("extends the user's crypto client (slot first) with one RLS batch containing $allOperations", () => {
		setupExtendsMock();
		createUserScopedDb("user-1");

		// The slot is added first, so Prisma runs it outside the batch.
		expect(extensionCalls().map((ext) => ext.name ?? "rls")).toEqual([
			"text-slot",
			"rls",
		]);
		const [ext] = rlsExtensions();
		expect(typeof ext?.query.$allModels.$allOperations).toBe("function");
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
			(ext: {
				name?: string;
				query: { $allModels: { $allOperations: Hook } };
			}) => {
				if (ext.name === "text-slot") return mockPrismaInstance;
				capturedHook = ext.query.$allModels.$allOperations;
				return failingDb;
			},
		);

		const userDb = createUserScopedDb("user-1") as typeof failingDb;
		await expect(userDb.user.findMany({})).rejects.toThrow("DB error");
	});

	it.each([
		"$queryRaw",
		"$executeRaw",
		"$queryRawUnsafe",
		"$executeRawUnsafe",
		"$queryRawTyped",
		"$executeRawTyped",
	])("refuses %s on a scoped client and names userTransaction", (name) => {
		setupExtendsMock();
		const userDb = createUserScopedDb("user-1") as unknown as Record<
			string,
			(...args: unknown[]) => unknown
		>;
		expect(() => userDb[name]?.("SELECT 1")).toThrow(/userTransaction/);
		expect(() => userDb[name]?.("SELECT 1")).toThrow(name);
		expect(mockExecuteRaw).not.toHaveBeenCalled();
		expect(mockTransaction).not.toHaveBeenCalled();
	});

	it("refuses a tagged-template raw query too", () => {
		setupExtendsMock();
		const userDb = createUserScopedDb("user-1") as unknown as {
			$queryRaw: (strings: TemplateStringsArray) => unknown;
		};
		expect(() => userDb.$queryRaw`SELECT 1`).toThrow(/userTransaction/);
		expect(mockExecuteRaw).not.toHaveBeenCalled();
		expect(mockTransaction).not.toHaveBeenCalled();
	});

	it.each([
		"$parent",
		"$extends",
		"$connect",
		"$disconnect",
		"$on",
		"$use",
		"$metrics",
	])("refuses %s on a scoped client", (name) => {
		setupExtendsMock();
		const userDb = createUserScopedDb("user-1") as unknown as Record<
			string,
			unknown
		>;
		expect(() => userDb[name]).toThrow(name);
		// Only the scoped client's own build (slot, then batch) extended anything.
		expect(mockPrismaInstance.$extends).toHaveBeenCalledTimes(2);
		expect(rlsExtensions()).toHaveLength(1);
	});

	it("still serves model delegates and inspection probes", () => {
		const fakeDb = setupExtendsMock();
		const userDb = createUserScopedDb("user-1") as unknown as Record<
			string,
			unknown
		>;
		expect(userDb.user).toBe(fakeDb.user);
		expect(() => userDb.$$typeof).not.toThrow();
	});

	it("refuses the array form of $transaction and runs nothing", () => {
		setupExtendsMock();
		const userDb = createUserScopedDb("user-1") as unknown as {
			$transaction: (ops: unknown[]) => unknown;
		};
		expect(() => userDb.$transaction([Promise.resolve(1)])).toThrow(
			/userTransaction/,
		);
		expect(mockTransaction).not.toHaveBeenCalled();
	});

	it("runs an interactive transaction on the user's crypto client, RLS set first", async () => {
		setupExtendsMock();
		const tx = { $executeRaw: vi.fn().mockResolvedValue(1) };
		mockTransaction.mockImplementation(
			async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
		);
		const userDb = createUserScopedDb("user-1") as unknown as {
			$transaction: (
				fn: (t: typeof tx) => Promise<unknown>,
				options?: unknown,
			) => Promise<unknown>;
		};
		const options = { timeout: 15_000 };

		const result = await userDb.$transaction(async (inner) => {
			expect(inner).toBe(tx);
			expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
			return "done";
		}, options);

		expect(result).toBe("done");
		expect(mockTransaction).toHaveBeenCalledTimes(1);
		expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function), options);
		expect(tx.$executeRaw.mock.calls[0]?.[1]).toBe("user-1");
	});
});
