/**
 * M6 PR0: the inventory of every statement that writes asset_account, found
 * by search (AGENTS 6.8), so a new writer cannot appear without this list
 * being read. Each file is classed for the device slice:
 *
 * - device (M6a/M6b): a write the engine will own on the device;
 * - online: stays a server-only write in M6;
 * - balance-only: moves balance or counted units, which the version column
 *   (a later PR) must not bump.
 *
 * Not in the list because no statement names the table: the account_leg
 * trigger (account_leg_moves_balance, balance and countedUnits), the
 * account_cap_counted() function, and the user delete cascade.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../../..");

// Whitespace and line breaks may sit between the parts of a call.
const CLIENT =
	/\.assetAccount\s*\.\s*(update|updateMany|create|createMany|upsert|delete|deleteMany)\b/g;
const RAW =
	/(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+("public"\.)?"?asset_account\b/gi;
// A nested write through the user relation (user.update({ data: { assetAccounts: { create } } })).
const NESTED =
	/\bassetAccounts\s*:\s*\{\s*(create|createMany|update|updateMany|upsert|connectOrCreate|delete|deleteMany)\b/g;

const SKIP_DIR = new Set([
	"node_modules",
	".next",
	"generated",
	"dist",
	".git",
]);
const isTestSupport = (path: string) =>
	/\.test\.tsx?$|__tests__|\/src\/test\/|test-support|test-fixtures|characterization-fixtures|\/e2e\//.test(
		`/${path}`,
	);

function sources(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (SKIP_DIR.has(entry.name)) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) sources(full, out);
		else if (/\.(ts|tsx|js|mjs|sql|go)$/.test(entry.name)) out.push(full);
	}
	return out;
}

const nestedWrites: string[] = [];

/** Statements per file that write asset_account. */
function found() {
	const writers: Record<string, number> = {};
	nestedWrites.length = 0;
	for (const dir of [
		"src",
		"scripts",
		"packages",
		"apps/mobile/src",
		"sidecar",
		"prisma",
	]) {
		let files: string[] = [];
		try {
			files = sources(join(ROOT, dir));
		} catch {
			continue;
		}
		for (const file of files) {
			const rel = relative(ROOT, file);
			// prisma/migrations is owned by the trigger list (a migration may
			// name the table once, and shipped ones never change): the
			// writers here are what runs after migrating.
			if (isTestSupport(rel) || rel.startsWith("prisma/migrations/")) continue;
			const text = readFileSync(file, "utf8");
			const nested = text.match(NESTED)?.length ?? 0;
			if (nested > 0) nestedWrites.push(rel);
			const n =
				(text.match(CLIENT)?.length ?? 0) + (text.match(RAW)?.length ?? 0);
			if (n > 0) writers[rel] = n;
		}
	}
	return writers;
}

/** file: [statements, class]. */
const WRITERS: Record<string, readonly [number, string]> = {
	// create, edit, close, reopen (3 updates) and the web delete: M6a
	// Rollback text that restores the leg trigger's function: balance only.
	"prisma/rollback/20261112100000_account_leg_half_even.sql": [
		2,
		"balance-only, trigger rollback",
	],
	"src/server/services/accounts/manage.ts": [5, "device (M6a), delete online"],
	"src/server/services/accounts/checkpoint.ts": [1, "device (M6a)"],
	"src/server/services/accounts/rate-type.mutation.ts": [2, "device (M6a)"],
	"src/server/services/accounts/update-balance.mutation.ts": [
		1,
		"device (M6a)",
	],
	"src/server/services/accounts/icon.ts": [1, "online, keeps updatedAt"],
	"src/server/services/accounts/delete-snapshot.ts": [
		2,
		"online, keeps updatedAt",
	],
	"src/server/services/envelope/debt.service.ts": [1, "online (terms)"],
	"src/server/services/income/move-in.mutation.ts": [1, "online, counted only"],
	"src/server/services/transfers/create.mutation.ts": [
		2,
		"device (M6b), counted only",
	],
	"src/server/services/transfers/delete.mutation.ts": [
		2,
		"device (M6b), counted only",
	],
};

describe("asset_account writers", () => {
	it("are exactly the ones this list names", () => {
		const names = Object.fromEntries(
			Object.entries(WRITERS).map(([file, [n]]) => [file, n]),
		);
		expect(found()).toEqual(names);
	});

	it("none writes through a nested assetAccounts relation", () => {
		found();
		expect(nestedWrites).toEqual([]);
	});
});
