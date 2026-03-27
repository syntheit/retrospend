/**
 * Mock Prisma Client Factory
 *
 * Creates a fully-typed mock DB client for use in unit tests.
 * Every model method is a vi.fn() that can be configured per test.
 *
 * Usage:
 *   const db = createMockDb()
 *   db.user.findUnique.mockResolvedValue(makeUser({ id: "user-1" }))
 *   // ... use db in your test
 *
 * Each call to createMockDb() returns a fresh instance with independent mocks,
 * so tests don't share state. Call vi.clearAllMocks() in beforeEach as well.
 */
import { vi } from "vitest";

// -- Model mock factory -------------------------------------------------------

function makeMockModel() {
	return {
		findUnique: vi.fn(),
		findUniqueOrThrow: vi.fn(),
		findFirst: vi.fn(),
		findFirstOrThrow: vi.fn(),
		findMany: vi.fn().mockResolvedValue([]),
		create: vi.fn(),
		createMany: vi.fn().mockResolvedValue({ count: 0 }),
		update: vi.fn(),
		updateMany: vi.fn().mockResolvedValue({ count: 0 }),
		upsert: vi.fn(),
		delete: vi.fn(),
		deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
		count: vi.fn().mockResolvedValue(0),
		aggregate: vi.fn().mockResolvedValue({
			_sum: {},
			_count: { _all: 0 },
			_avg: {},
			_min: {},
			_max: {},
		}),
		groupBy: vi.fn().mockResolvedValue([]),
	};
}

// -- Full mock DB -------------------------------------------------------------

/**
 * Creates a mock Prisma client with all models and transaction support.
 *
 * $transaction supports two modes:
 * - Interactive callback: `$transaction(async (tx) => { ... })` - passes the mock db as tx
 * - Batch array: `$transaction([op1, op2])` - resolves each op in parallel
 */
export function createMockDb() {
	const models = {
		user: makeMockModel(),
		expense: makeMockModel(),
		category: makeMockModel(),
		budget: makeMockModel(),
		recurringExpense: makeMockModel(),
		exchangeRate: makeMockModel(),
		asset: makeMockModel(),
		assetSnapshot: makeMockModel(),
		project: makeMockModel(),
		projectParticipant: makeMockModel(),
		sharedTransaction: makeMockModel(),
		splitParticipant: makeMockModel(),
		settlement: makeMockModel(),
		shadowProfile: makeMockModel(),
		guestSession: makeMockModel(),
		magicLink: makeMockModel(),
		billingPeriod: makeMockModel(),
		auditLog: makeMockModel(),
		auditLogEntry: makeMockModel(),
		notification: makeMockModel(),
		notificationPreference: makeMockModel(),
		paymentMethod: makeMockModel(),
		importJob: makeMockModel(),
	};

	const db = {
		...models,
		$transaction: vi.fn().mockImplementation(
			async (cbOrOps: ((tx: typeof db) => Promise<unknown>) | Promise<unknown>[]) => {
				if (typeof cbOrOps === "function") {
					return cbOrOps(db);
				}
				return Promise.all(cbOrOps);
			},
		),
		$executeRaw: vi.fn().mockResolvedValue(1),
		$queryRaw: vi.fn().mockResolvedValue([]),
	};

	return db;
}

export type MockDb = ReturnType<typeof createMockDb>;
