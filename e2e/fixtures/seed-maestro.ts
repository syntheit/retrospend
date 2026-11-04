/**
 * Seeds one database for the Maestro runs (apps/mobile/maestro/server.sh):
 *
 *   pnpm exec tsx e2e/fixtures/seed-maestro.ts postgresql://.../rs_e2e_template
 *
 * Same personas and ledger as the web e2e (seed.ts); only the guard differs
 * (../maestro-db-guard.ts). The schema must be migrated already.
 */
import { assertMaestroDatabase } from "../maestro-db-guard";
import { seedE2eDatabase } from "./seed";

async function main(): Promise<void> {
	const url = process.argv[2];
	if (!url) throw new Error("usage: seed-maestro.ts <database url>");
	await seedE2eDatabase(url, undefined, assertMaestroDatabase);
	console.log("seeded");
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
