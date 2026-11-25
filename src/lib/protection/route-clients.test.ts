import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The paths test for the web's side of the key routes (AGENTS.md 6.8): which
// files of src call the routes that release wraps, take a recovery proof or
// replace a recovery key. The list is a search result, not a promise; a new
// caller fails here until it is added with its reason.
const SRC = join(__dirname, "..", "..");

function files(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory())
			return entry.name === "server" || entry.name === "node_modules"
				? []
				: files(path);
		return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
			? [path]
			: [];
	});
}

const callers = (needle: string) =>
	files(SRC)
		.filter((path) => readFileSync(path, "utf8").includes(needle))
		.map((path) => relative(SRC, path))
		.sort();

describe("the web's callers of the key routes", () => {
	it("keys/open is read by the enable read-back and by Make new key, nothing else", () => {
		expect(callers("/api/v1/me/protection/keys/open")).toEqual([
			"lib/protection/enable.ts",
			"lib/protection/new-key.ts",
		]);
	});

	it("the recovery key route is called by Make new key only", () => {
		expect(callers("/api/v1/me/protection/recovery-key")).toEqual([
			"lib/protection/new-key.ts",
		]);
	});

	it("the recovery routes, which take a reset token and a proof, are called by the recovery adapter only", () => {
		expect(callers("/api/v1/auth/recovery")).toEqual([
			"lib/protection/recovery.ts",
		]);
	});
});
