/**
 * Gives every category a name index (E2EE lane D9), the keyed hash that keeps
 * names unique once they are ciphertext. Rows the app wrote before that
 * migration have none, and a migration cannot compute them: each user's hash
 * key comes from their data key, which only the app can open.
 *
 * Safe to run again and to interrupt: a user's rows are done in one
 * transaction, and rows that already have an index are skipped. It rewrites
 * one column ("nameIndex"); names and everything else are untouched. It
 * prints counts and never a name or a user id.
 *
 * A category it cannot index because another category of the same person has
 * the same trimmed name is reported as a conflict and left alone; rename or
 * merge one of the two and run again.
 *
 * Needs the app's environment: DATABASE_URL (the owner role, as the app uses),
 * BETTER_AUTH_SECRET, and DATA_MASTER_KEY or DATA_MASTER_KEY_FILE.
 *
 * Usage:
 *   pnpm exec tsx scripts/backfill-category-name-index.ts          # dry run
 *   pnpm exec tsx scripts/backfill-category-name-index.ts --apply  # write
 */
import { getMasterKeyring } from "../src/server/crypto/master-key";
import { db } from "../src/server/db";
import { backfillCategoryNameIndexes } from "../src/server/services/category-name-index.service";

const APPLY = process.argv.includes("--apply");

async function main() {
	const [missing, users] = await Promise.all([
		db.category.count({ where: { nameIndex: null } }),
		db.category.findMany({
			where: { nameIndex: null },
			distinct: ["userId"],
			select: { userId: true },
		}),
	]);
	console.log(
		`Categories without a name index: ${missing}, for ${users.length} users`,
	);
	if (!APPLY) {
		console.log("Dry run. Pass --apply to write.");
		return;
	}
	const masterKeyring = getMasterKeyring();
	if (!masterKeyring) {
		console.error("DATA_MASTER_KEY or DATA_MASTER_KEY_FILE is not set.");
		process.exit(1);
	}
	let done = 0;
	const total = await backfillCategoryNameIndexes(db, masterKeyring, {
		onUser: () => {
			done += 1;
			if (done % 100 === 0) console.log(`Users done: ${done}`);
		},
	});
	console.log(`Updated: ${total.updated}`);
	console.log(`Conflicts left without an index: ${total.conflicts}`);
	const left = await db.category.count({ where: { nameIndex: null } });
	console.log(`Categories still without a name index: ${left}`);
}

main()
	.catch((error: unknown) => {
		console.error(
			`Backfill failed: ${error instanceof Error ? error.message : "unknown error"}`,
		);
		process.exitCode = 1;
	})
	.finally(() => db.$disconnect());
