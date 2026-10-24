/**
 * Setup for `pnpm test` (the unit suite, no database).
 *
 * The settlement lock (services/corrections/locks.ts) reads and writes through
 * a real Postgres: a candidate query over split rows and the
 * `lock_settled_splits` function. The in-memory database the payment unit
 * tests run on has neither, and those tests are about allocation and
 * balances, so the lock step is a no-op here. It is tested for real in
 * corrections.pg.test.ts, and its pure part (settledAsOf) runs unmocked.
 */
import { vi } from "vitest";

vi.mock("~/server/services/corrections/locks", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("~/server/services/corrections/locks")
	>()),
	lockSettledSplits: vi.fn(async () => 0),
}));
