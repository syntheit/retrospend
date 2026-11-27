/**
 * Vectors for the account writes (create, edit, close, reopen, balance update,
 * rate type). Every expected value is derived by hand in the comment above it,
 * from the rules the server runs (accounts/manage.ts, checkpoint.ts,
 * rate-type.mutation.ts) and the domain's plans:
 *
 * - Home ARS, preferred type blue (1 USD = 1,545 ARS blue, 1,050 official),
 *   saved zone Buenos Aires (UTC-3, no DST). A rate is "units per USD".
 * - An account stores the rate of its type on the day it is written (1 for a
 *   USD account, whose type values the home side instead) and a USD account
 *   keeps the type it was asked for. A balance typed by hand is a Not logged
 *   leg for the difference, in what you have: a liability's balance counts
 *   against you, so paying it down is a positive leg. The leg's home value is
 *   the account's own rate type (a USD account at blue: 200 x 1,545 = 309,000).
 * - Days: create, edit and balance update date their snapshot and leg by the
 *   person's zone; close and reopen by the UTC day (an owner question, pinned).
 *   One snapshot per account per day: a second write that day replaces it.
 * - The version moves by 1 for each statement that changes type, currency,
 *   rate type, closedAt, inBudget, isLiquid, interestRate, minimumPayment or
 *   dueDate, or the stored rate while the type is custom. A balance, the
 *   counted units, a name and a same-type rate refresh never move it.
 *   (ACCOUNT_VERSION_COLUMNS.) The engine's number is a placeholder; the vectors
 *   hold the server to the same count.
 * - A net worth minor is the home amount x 100.
 *
 * The expected rows are compared by value, decimals as numbers and dates as
 * instants. `usd` is the snapshot's USD value, which only the server keeps.
 */
import type { AccountVector } from "./account-vector-types";
import { editVectors } from "./account-vectors-edits";
import { lifecycleVectors } from "./account-vectors-lifecycle";
import { moneyVectors } from "./account-vectors-money";
import { refusalVectors } from "./account-vectors-refusals";
import { typedVectors } from "./account-vectors-typed";

export * from "./account-vector-types";

export const accountVectors: AccountVector[] = [
	...lifecycleVectors,
	...moneyVectors,
	...editVectors,
	...typedVectors,
	...refusalVectors,
];
