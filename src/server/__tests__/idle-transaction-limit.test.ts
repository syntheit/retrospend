/**
 * Postgres ends a connection idle inside a transaction after
 * IDLE_IN_TRANSACTION_TIMEOUT_MS. Prisma's own transaction timeout bounds how
 * long any interactive transaction lives, so every explicit one has to stay
 * below that limit: raising one past it would let Postgres kill a transaction
 * that is still working.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { IDLE_IN_TRANSACTION_TIMEOUT_MS } from "~/server/db-pool-config";
import { LEGACY_MIGRATE_TIMEOUT_MS } from "~/server/services/envelope/legacy-migrate.batch";
import { MOVE_TIMEOUT_MS } from "~/server/services/envelope/legacy-lazy";
import { IMPORT_TIMEOUT_MS } from "~/server/services/import/runner";
import { PREVIEW_TIMEOUT_MS } from "~/server/services/preview";
import { PUSH_FAN_OUT_TIMEOUT_MS } from "~/server/services/push/fanout";
import { FAN_OUT_TIMEOUT_MS } from "~/server/services/webhooks/fanout";

const TRANSACTION_TIMEOUTS = {
	IMPORT_TIMEOUT_MS,
	LEGACY_MIGRATE_TIMEOUT_MS,
	MOVE_TIMEOUT_MS,
	FAN_OUT_TIMEOUT_MS,
	PUSH_FAN_OUT_TIMEOUT_MS,
	PREVIEW_TIMEOUT_MS,
};

/** Files whose large `timeout:` is an HTTP request's, not a transaction's. */
const HTTP_TIMEOUT_FILES = new Set([
	"src/server/api/routers/admin.ts",
	"src/server/services/exchange-rate.service.ts",
]);

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
			? [path]
			: [];
	});
}

describe("interactive transaction timeouts", () => {
	for (const [name, ms] of Object.entries(TRANSACTION_TIMEOUTS)) {
		it(`${name} is below the idle in transaction timeout`, () => {
			expect(ms).toBeLessThan(IDLE_IN_TRANSACTION_TIMEOUT_MS);
		});
	}

	it("the import timeout is the longest one in use", () => {
		expect(Math.max(...Object.values(TRANSACTION_TIMEOUTS))).toBe(
			IMPORT_TIMEOUT_MS,
		);
	});

	it("no other source file sets a timeout at or above the limit", () => {
		const root = join(__dirname, "..", "..", "..");
		const offenders: string[] = [];
		for (const file of sourceFiles(join(root, "src"))) {
			const path = relative(root, file);
			if (HTTP_TIMEOUT_FILES.has(path)) continue;
			const text = readFileSync(file, "utf8");
			for (const match of text.matchAll(/timeout: *([0-9_]+)\b/g)) {
				const ms = Number((match[1] ?? "").replaceAll("_", ""));
				if (ms >= IDLE_IN_TRANSACTION_TIMEOUT_MS) offenders.push(path);
			}
		}
		expect(offenders).toEqual([]);
	});
});
