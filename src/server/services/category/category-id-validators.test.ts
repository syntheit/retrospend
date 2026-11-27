/**
 * The cuid-only id validators, found by search, and what they do to the id a
 * device makes. A category or an account made on a device has a UUID id,
 * which a `z.cuid()` input refuses, so the web could not read, edit or use
 * it. M3 PR1c moved every such reference to one schema that takes both; this
 * pins that none came back.
 */

import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { idSchema } from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	accountIdSchema,
	categoryIdSchema,
	projectIdSchema,
} from "~/lib/schemas/row-ids";
import { OTHER_ID_VALIDATORS, type Validators } from "./category-id-validators";

const ROOT = join(__dirname, "../../../..");
const SKIP_DIR = new Set([
	"node_modules",
	".next",
	"generated",
	"dist",
	".git",
]);
const isTestSupport = (path: string) =>
	/\.test\.tsx?$|__tests__|\/src\/test\/|test-support|test-fixtures|\/e2e\//.test(
		`/${path}`,
	);

function sources(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (SKIP_DIR.has(entry.name)) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) sources(full, out);
		else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
	}
	return out;
}

// Every spelling of a cuid validator: z.cuid(), z.string().cuid(), cuid2.
const ANY = /\bcuid2?\s*\(/g;
const NAMED = /(\w+)\s*:\s*z\s*\.\s*cuid\s*\(/g;

/** Field name -> count of named cuid validators, per file; and the file's total. */
function scan() {
	const named: Validators = {};
	const unnamed: string[] = [];
	for (const dir of ["src", "packages", "apps/mobile/src"]) {
		for (const file of sources(join(ROOT, dir))) {
			const rel = relative(ROOT, file);
			if (isTestSupport(rel)) continue;
			// The one owner of the cuid-or-uuid rule; it names z.cuid() on purpose.
			if (rel === "src/lib/schemas/row-ids.ts") continue;
			// Comments and doc strings may name the validator; code does not.
			const text = readFileSync(file, "utf8")
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/\/\/.*$/gm, "");
			const total = text.match(ANY)?.length ?? 0;
			if (total === 0) continue;
			const fields: Record<string, number> = {};
			for (const m of text.matchAll(NAMED))
				fields[m[1] as string] = (fields[m[1] as string] ?? 0) + 1;
			named[rel] = fields;
			const counted = Object.values(fields).reduce((a, b) => a + b, 0);
			if (counted !== total) unnamed.push(rel);
		}
	}
	return { named, unnamed };
}

describe("cuid-only id validators", () => {
	it("every one is a named field, so none hides in an array or a chain", () => {
		expect(scan().unnamed).toEqual([]);
	});

	it("are exactly the ids the list names, built by search from the source", () => {
		expect(scan().named).toEqual(OTHER_ID_VALIDATORS);
	});

	it("none of them is a category, account, asset or template reference", () => {
		const fields = Object.values(scan().named).flatMap((f) => Object.keys(f));
		for (const field of fields)
			expect(field).not.toMatch(/categor|account|asset|template|target|project/i);
		// The ids named `id` belong to the invite router only: every other
		// router and input file that takes a category or an account id by
		// that name uses the shared schemas.
		const idFiles = Object.entries(scan().named)
			.filter(([, f]) => "id" in f)
			.map(([file]) => file);
		expect(idFiles).toEqual(["src/server/api/routers/invite.ts"]);
	});
});

describe("categoryIdSchema and accountIdSchema", () => {
	const uuid = randomUUID();
	const cuid = `c${uuid.replaceAll("-", "")}`;

	it("z.cuid() refuses a UUID, the shared schemas and v1's idSchema take both", () => {
		expect(z.cuid().safeParse(uuid).success).toBe(false);
		expect(z.cuid().safeParse(cuid).success).toBe(true);
		for (const schema of [
			categoryIdSchema,
			accountIdSchema,
			projectIdSchema,
			idSchema,
		]) {
			expect(schema.safeParse(uuid).success).toBe(true);
			expect(schema.safeParse(cuid).success).toBe(true);
		}
	});

	it("still refuse what is neither shape", () => {
		for (const schema of [
			categoryIdSchema,
			accountIdSchema,
			projectIdSchema,
		]) {
			for (const bad of ["", "not an id", "123", `${uuid}x`, "../x", null])
				expect(schema.safeParse(bad).success).toBe(false);
		}
	});
});
