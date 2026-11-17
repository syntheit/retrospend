// Catches: a background job, a web route or a new service reaching the tRPC
// bridge's "already guarded" door. V1_GUARDED tells the tRPC guard that a v1
// route already ran the protection check, so only the v1 services may pass
// it, and those services may be called only from the v1 transport
// (src/server/api/v1/**), where that check ran (AGENTS.md 6.8). A job that
// imports one of them would skip the guard for a protected account. It is a
// static scan of import specifiers (static, dynamic and re-export), not a
// type check.
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scanSources, withoutComments } from "./source-scan";
import { REPO_ROOT } from "./uiRules/paths";

const SERVICES = "src/server/services/api-v1";
const BRIDGE = `${SERVICES}/trpc-bridge.ts`;
const TEST_FILE = /(\.test\.tsx?$|\/__tests__\/)/;

const files = scanSources({ roots: ["src"], include: /\.tsx?$/ }).map((f) =>
	relative(REPO_ROOT, f),
);
const texts = new Map(
	files.map((f) => [
		f,
		withoutComments(readFileSync(join(REPO_ROOT, f), "utf8")),
	]),
);

/** The repo-relative file an import specifier names, or null for a package. */
function resolveImport(from: string, spec: string): string | null {
	let base: string;
	if (spec.startsWith("~/")) base = join("src", spec.slice(2));
	else if (spec.startsWith("."))
		base = relative(REPO_ROOT, resolve(REPO_ROOT, dirname(from), spec));
	else return null;
	const hit = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((c) =>
		texts.has(c),
	);
	return hit ?? null;
}

const SPEC = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"']+)["']/g;

function importersOf(target: (file: string) => boolean): string[] {
	const out: string[] = [];
	for (const [file, text] of texts)
		for (const m of text.matchAll(SPEC)) {
			const hit = resolveImport(file, m[1] ?? "");
			if (hit && target(hit)) {
				out.push(file);
				break;
			}
		}
	return out.sort();
}

/** The services that pass V1_GUARDED, read from the source. */
const GUARDED_SERVICES = files
	.filter(
		(f) =>
			f.startsWith(`${SERVICES}/`) &&
			!TEST_FILE.test(f) &&
			/\bV1_GUARDED\b/.test(texts.get(f) ?? "") &&
			f !== BRIDGE,
	)
	.sort();

describe("the tRPC bridge's V1_GUARDED door", () => {
	it("finds the v1 services that pass it", () => {
		expect(GUARDED_SERVICES.length).toBeGreaterThanOrEqual(10);
	});

	it("is named only by those services, the bridge and a test", () => {
		const users = files.filter(
			(f) => /\bV1_GUARDED\b/.test(texts.get(f) ?? "") && !TEST_FILE.test(f),
		);
		expect(users.sort()).toEqual([...GUARDED_SERVICES, BRIDGE].sort());
	});

	it("is imported from the bridge only by v1 services (and tests)", () => {
		const importers = importersOf((f) => f === BRIDGE).filter(
			(f) => !TEST_FILE.test(f),
		);
		const outside = importers.filter((f) => !f.startsWith(`${SERVICES}/`));
		expect(outside).toEqual([]);
	});

	it("reaches its services only from the v1 transport, themselves and tests", () => {
		const guarded = new Set(GUARDED_SERVICES);
		const outside = importersOf((f) => guarded.has(f)).filter(
			(f) =>
				!TEST_FILE.test(f) &&
				!f.startsWith("src/server/api/v1/") &&
				!guarded.has(f),
		);
		expect(outside).toEqual([]);
	});
});
