/**
 * Moves one user's queue-imported expenses from midnight UTC to midnight of
 * the same calendar date in their time zone. Rules: src/server/import-date-repair.ts.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/repair-import-dates.ts --user <id or email> --tz America/Argentina/Buenos_Aires          # dry run
 *   DATABASE_URL=... npx tsx scripts/repair-import-dates.ts --user <id or email> --tz America/Argentina/Buenos_Aires --apply  # write
 *
 * Dry run is the default. --apply runs every update in one transaction.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { normalizeTimeZone } from "@retrospend/domain/time-zone";
import {
	IMPORT_PRICING_SOURCES,
	planImportDateRepair,
} from "../src/server/import-date-repair";
import { PrismaClient } from "../generated/prisma/client";

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(name);
	return i === -1 ? undefined : process.argv[i + 1];
}

const APPLY = process.argv.includes("--apply");
const userArg = arg("--user");
const timeZone = normalizeTimeZone(arg("--tz"));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
	console.error("DATABASE_URL environment variable is required.");
	process.exit(1);
}
if (!userArg || !timeZone) {
	console.error("Usage: --user <id or email> --tz <IANA zone> [--apply]");
	process.exit(1);
}

const pool = new Pool({ connectionString });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
	const user = await db.user.findFirst({
		where: { OR: [{ id: userArg }, { email: userArg }] },
		select: { id: true, email: true },
	});
	if (!user) {
		console.error(`No user matches ${userArg}.`);
		process.exit(1);
	}

	const rows = await db.expense.findMany({
		where: {
			userId: user.id,
			pricingSource: { in: [...IMPORT_PRICING_SOURCES] },
		},
		select: { id: true, date: true, pricingSource: true, title: true },
		orderBy: { date: "asc" },
	});
	const fixes = planImportDateRepair(rows, timeZone as string);
	const titles = new Map(rows.map((r) => [r.id, r.title]));

	console.log(
		`User ${user.email}: ${rows.length} imported expenses, ${fixes.length} stored at midnight UTC.`,
	);
	for (const fix of fixes.slice(0, 20)) {
		console.log(
			`  ${fix.from.toISOString()} -> ${fix.to.toISOString()}  ${titles.get(fix.id) ?? ""}`,
		);
	}
	if (fixes.length > 20) console.log(`  ... and ${fixes.length - 20} more`);

	if (!APPLY) {
		console.log("\nDry run. Pass --apply to write.");
		return;
	}

	await db.$transaction(
		fixes.map((fix) =>
			db.expense.update({ where: { id: fix.id }, data: { date: fix.to } }),
		),
	);
	console.log(`\nUpdated ${fixes.length} expenses.`);
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await db.$disconnect();
		await pool.end();
	});
