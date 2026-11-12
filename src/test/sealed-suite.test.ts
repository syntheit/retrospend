/**
 * The sealed pg suite's two escape hatches stay exact (sealed-sweep.ts):
 * - sealed-suite.exclude.json lists exactly the pg files that set a master
 *   key, sealing or the epoch themselves, each with a reason;
 * - sealed-sweep.allow.json names pg files that run sealed, one mapped
 *   column each, and never more than MAX_ALLOWED of them.
 */
import { existsSync, globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mappedColumns } from "~/server/crypto/fields";

/** Lower it as entries go; never raise it. */
const MAX_ALLOWED = 0;

const SETS_KEY_STATE =
	/newMasterKeyring|crypto\/master-key"|new Keyring\(|setSealingForTests|writeEpoch|"fieldEncryptionSince"/;

const json = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
const excluded = json<Record<string, string>>(
	"src/test/sealed-suite.exclude.json",
);
const allowed = json<Record<string, { column: string; reason: string }>>(
	"src/test/sealed-sweep.allow.json",
);
const pgFiles = globSync("src/**/*.pg.test.ts").sort();

describe("the sealed suite's exclusions", () => {
	it("list exactly the pg files that set their own key state", () => {
		const scanned = pgFiles.filter((file) =>
			SETS_KEY_STATE.test(readFileSync(file, "utf8")),
		);
		expect(Object.keys(excluded).sort()).toEqual(scanned);
	});

	it("each say why", () => {
		for (const reason of Object.values(excluded))
			expect(reason.trim()).not.toBe("");
	});
});

describe("the sweep's allow list", () => {
	it(`holds at most ${MAX_ALLOWED} entries`, () => {
		expect(Object.keys(allowed).length).toBeLessThanOrEqual(MAX_ALLOWED);
	});

	it("names pg files that run sealed, a mapped column each, with a reason", () => {
		const cells = new Set(mappedColumns().map(([t, c]) => `${t}.${c}`));
		for (const [file, entry] of Object.entries(allowed)) {
			expect(existsSync(file) && file.endsWith(".pg.test.ts"), file).toBe(
				true,
			);
			expect(Object.hasOwn(excluded, file), file).toBe(false);
			expect(cells.has(entry.column), entry.column).toBe(true);
			expect(entry.reason.trim()).not.toBe("");
		}
	});
});
