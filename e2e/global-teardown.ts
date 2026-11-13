import type { FullConfig } from "@playwright/test";
import { Pool } from "pg";
import { E2E_DATABASE_URL, E2E_SEALED } from "./constants";
import { readSeedSnapshot } from "./sealing-seed";
import { sweepSealing } from "./sealing-sweep";

/**
 * Runs after every spec of the run, and so in every CI shard. Sealed runs
 * sweep the database for plaintext the suite left (e2e/sealing-sweep.ts); an
 * unsealed run has nothing to check. A finding fails the run.
 */
export default async function globalTeardown(
	_config: FullConfig,
): Promise<void> {
	if (!E2E_SEALED) return;
	const pool = new Pool({ connectionString: E2E_DATABASE_URL });
	try {
		const found = await sweepSealing(pool, readSeedSnapshot());
		if (found.length > 0)
			throw new Error(
				`Sealed e2e sweep: plaintext in the database after the suite. ${found.join("; ")}`,
			);
		console.log("Sealed e2e sweep: no plaintext after the seed");
	} finally {
		await pool.end();
	}
}
