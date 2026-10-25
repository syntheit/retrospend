/**
 * Stand-in for services/corrections/locks.ts in the payment unit tests, which
 * run on an in-memory database that has neither the candidate query nor the
 * `lock_settled_splits` function. Those tests are about allocation and
 * balances; the real lock is tested in corrections.pg.test.ts and its pure
 * part (settledAsOf) in locks.test.ts. Use it per file:
 *
 *   vi.mock("~/server/services/corrections/locks", () => import("~/test/locks-stub"));
 */
export const lockSettledSplits = async () => 0;
export const relockPair = async () => {};
