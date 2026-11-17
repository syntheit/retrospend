// The client layering: one raw base Prisma client,
// private to db-core.ts, and every transaction that sets the RLS identity is
// built in one of two files. A source scan keeps it that way, since a
// hand-rolled set_config transaction or a second client would skip the
// extension slot. The instance key's service flag is set in one place too, so
// no other code reaches for it by mistake.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scanSources, withoutComments } from "~/test/source-scan";
import { REPO_ROOT } from "~/test/uiRules/paths";

const appFiles = () =>
	scanSources({
		roots: ["src"],
		include: /\.tsx?$/,
		exclude: /(\.test\.tsx?|[\\/]src[\\/]test[\\/]|[\\/]__tests__[\\/])/,
	});

const relative = (file: string) => file.slice(REPO_ROOT.length + 1);

const filesMatching = (pattern: RegExp) =>
	appFiles()
		.filter((file) => pattern.test(withoutComments(readFileSync(file, "utf8"))))
		.map(relative)
		.sort();

const HAND_BUILT_CLIENTS: Record<string, string> = {
	"scripts/repair-import-dates.ts":
		"reads no user text (ids and dates only, printed by id) and writes only dates",
	"scripts/repair-amount-in-usd.ts": "reads and writes amounts, no mapped text",
	"scripts/fix-wealth-data.ts": "asset snapshots only, no mapped text",
	"scripts/backfill-rate-history.ts": "exchange rates only, no text",
	"e2e/fixtures/seed.ts":
		"seeds the e2e database before any server runs, plaintext by design",
	"e2e/fixtures/keyed-user.ts":
		"writes a protection key set and reads the user id, no mapped text",
};

describe("client layering", () => {
	it("sets the RLS identity only in db-core.ts and db-tx.ts", () => {
		expect(filesMatching(/set_config\(\s*'app\.current_user_id'/)).toEqual([
			"src/server/db-core.ts",
			"src/server/db-tx.ts",
		]);
	});

	it("builds the raw Prisma client only in db-core.ts", () => {
		expect(filesMatching(/new\s+PrismaClient\s*\(/)).toEqual([
			"src/server/db-core.ts",
		]);
	});

	// Outside src a client built by hand has no sealing extension: what it reads
	// of a mapped column is raw, and what it writes there is stored as given.
	// Each one is listed with why that is fine; a new one needs a line here.
	it("builds a raw client outside src only in the listed scripts and fixtures", () => {
		const outside = scanSources({
			roots: ["scripts", "e2e", "prisma", "packages"],
			include: /\.(tsx?|mjs|js)$/,
			exclude: /[\\/]node_modules[\\/]/,
		})
			.filter((file) =>
				/new\s+PrismaClient\s*\(/.test(
					withoutComments(readFileSync(file, "utf8")),
				),
			)
			.map(relative)
			.sort();
		expect(outside).toEqual(Object.keys(HAND_BUILT_CLIENTS).sort());
	});

	it("sets the instance key's service flag only in the instance key service", () => {
		expect(filesMatching(/app\.instance_service/)).toEqual([
			"src/server/services/keys/instance-key.service.ts",
		]);
	});

	it("catches a hand-rolled identity transaction", () => {
		const source =
			"await tx.$executeRaw`SELECT set_config('app.current_user_id', ${id}, true)`";
		expect(/set_config\(\s*'app\.current_user_id'/.test(source)).toBe(true);
	});
});
