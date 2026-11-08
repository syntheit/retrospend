import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envState = vi.hoisted(() => ({
	env: {} as { DATA_MASTER_KEY?: string; DATA_MASTER_KEY_FILE?: string },
}));
vi.mock("~/env", () => ({
	get env() {
		return envState.env;
	},
}));

import { FieldCryptoError, openField, sealField } from "./field-crypto";
import {
	assertMasterKeyConfig,
	getMasterKeyring,
	loadMasterKeyring,
	resetMasterKeyringForTests,
} from "./master-key";

const HEX_A = "0f".repeat(32);
const HEX_B = "a1".repeat(32);
const CELL = { table: "Category", column: "name", rowId: "r1" };

function failureOf(run: () => unknown): FieldCryptoError {
	try {
		run();
	} catch (error) {
		if (error instanceof FieldCryptoError) return error;
		throw error;
	}
	throw new Error("did not throw");
}

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "master-key-"));
	envState.env = {};
	resetMasterKeyringForTests();
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("loadMasterKeyring", () => {
	it("is absent when neither setting is present", () => {
		expect(loadMasterKeyring({})).toBeUndefined();
	});

	it("reads a bare 64-hex key as id 1", () => {
		const ring = loadMasterKeyring({ DATA_MASTER_KEY: HEX_A });
		expect(ring?.currentId).toBe(1);
		expect(ring?.has(1)).toBe(true);
	});

	it("reads id:hex entries; the first is current and the rest only open", () => {
		const ring = loadMasterKeyring({
			DATA_MASTER_KEY: `2:${HEX_B},1:${HEX_A}`,
		});
		expect(ring?.currentId).toBe(2);
		expect(ring?.has(1)).toBe(true);
		const old = loadMasterKeyring({ DATA_MASTER_KEY: HEX_A });
		if (!ring || !old) throw new Error("no keyring");
		expect(openField(ring, sealField(old, "kept", CELL), CELL)).toBe("kept");
	});

	it("takes the same key from a file, with a trailing newline", () => {
		const path = join(dir, "key");
		writeFileSync(path, `${HEX_A}\n`);
		const fromFile = loadMasterKeyring({ DATA_MASTER_KEY_FILE: path });
		const inline = loadMasterKeyring({ DATA_MASTER_KEY: HEX_A });
		if (!fromFile || !inline) throw new Error("no keyring");
		expect(openField(fromFile, sealField(inline, "x", CELL), CELL)).toBe("x");
	});

	it("takes entries on separate lines in a file", () => {
		const path = join(dir, "key");
		writeFileSync(path, `2:${HEX_B}\n1:${HEX_A}\n`);
		expect(loadMasterKeyring({ DATA_MASTER_KEY_FILE: path })?.currentId).toBe(
			2,
		);
	});

	const malformed: Array<[string, string]> = [
		["too short", HEX_A.slice(0, 62)],
		["too long", `${HEX_A}00`],
		["not hex", `${"zz".repeat(32)}`],
		["base64 instead of hex", Buffer.alloc(32, 7).toString("base64")],
		["all zero", "00".repeat(32)],
		["id zero", `0:${HEX_A}`],
		["id with a leading zero", `01:${HEX_A}`],
		["id too large", `4294967296:${HEX_A}`],
		["negative id", `-1:${HEX_A}`],
		["duplicate id", `1:${HEX_A},1:${HEX_B}`],
		["bare key beside others", `${HEX_A},2:${HEX_B}`],
		["only whitespace", "  \n"],
		["junk beside a good key", `${HEX_A} extra`],
	];
	for (const [label, value] of malformed) {
		it(`refuses ${label}, without echoing it`, () => {
			const error = failureOf(() =>
				loadMasterKeyring({ DATA_MASTER_KEY: value }),
			);
			expect(error.code).toBe("bad_key");
			expect(error.message).not.toContain(HEX_A);
			expect(error.message).not.toContain(value.trim() || "never-empty");
		});
	}

	it("refuses an empty or missing file", () => {
		const empty = join(dir, "empty");
		writeFileSync(empty, "");
		expect(
			failureOf(() => loadMasterKeyring({ DATA_MASTER_KEY_FILE: empty })).code,
		).toBe("bad_key");
		expect(
			failureOf(() =>
				loadMasterKeyring({ DATA_MASTER_KEY_FILE: join(dir, "missing") }),
			).code,
		).toBe("bad_key");
	});

	it("refuses both settings at once", () => {
		const path = join(dir, "key");
		writeFileSync(path, HEX_A);
		expect(
			failureOf(() =>
				loadMasterKeyring({
					DATA_MASTER_KEY: HEX_A,
					DATA_MASTER_KEY_FILE: path,
				}),
			).code,
		).toBe("bad_key");
	});
});

describe("assertMasterKeyConfig", () => {
	it("passes with nothing set", () => {
		expect(() => assertMasterKeyConfig()).not.toThrow();
		expect(getMasterKeyring()).toBeUndefined();
	});

	it("passes with a good key", () => {
		envState.env = { DATA_MASTER_KEY: HEX_A };
		expect(() => assertMasterKeyConfig()).not.toThrow();
		expect(getMasterKeyring()?.currentId).toBe(1);
	});

	it("stops the server for a malformed key and never prints it", () => {
		const bad = `${HEX_A.slice(0, 40)}-not-a-key`;
		envState.env = { DATA_MASTER_KEY: bad };
		let message = "";
		try {
			assertMasterKeyConfig();
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain("DATA_MASTER_KEY");
		expect(message).not.toContain(HEX_A.slice(0, 40));
		expect(message).not.toContain("not-a-key");
		// It fails again next time instead of caching a half state.
		expect(() => assertMasterKeyConfig()).toThrow();
	});
});
