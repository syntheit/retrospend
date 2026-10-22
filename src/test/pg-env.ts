/**
 * Setup file for pg tests (runs in each worker before the test file loads).
 * `~/env` and `~/server/db` read process.env when first imported, so the run
 * database has to be in place before any test imports them.
 */
import { inject } from "vitest";

process.env.DATABASE_URL = inject("pgDatabaseUrl");
// env validation requires a secret; pg tests never sign anything.
process.env.BETTER_AUTH_SECRET ??= "pg-test-placeholder-not-a-secret";
