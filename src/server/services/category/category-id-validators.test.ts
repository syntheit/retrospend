/**
 * M3 PR0: the cuid-only id validators, found by search, and what they do to
 * the id a device makes. A category made on a device has a UUID id, which a
 * `z.cuid()` input refuses, so the web could not file an expense under it,
 * edit it or remove it until PR1 widens these (slice Rev 2 item 5).
 */

import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { idSchema } from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	ACCOUNT_ID_VALIDATORS,
	CATEGORY_ID_VALIDATORS,
	OTHER_ID_VALIDATORS,
	type Validators,
} from "./category-id-validators";

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

/** The three lists merged into one file -> field -> count map. */
function merged() {
	const all: Validators = {};
	for (const list of [
		CATEGORY_ID_VALIDATORS,
		ACCOUNT_ID_VALIDATORS,
		OTHER_ID_VALIDATORS,
	])
		for (const [file, fields] of Object.entries(list))
			for (const [field, n] of Object.entries(fields))
				all[file] = { ...all[file], [field]: (all[file]?.[field] ?? 0) + n };
	return all;
}

describe("cuid-only id validators", () => {
	it("every one is a named field, so none hides in an array or a chain", () => {
		expect(scan().unnamed).toEqual([]);
	});

	it("are exactly the category, account and other ids the lists name", () => {
		expect(scan().named).toEqual(merged());
	});

	it("the category list holds the thirteen references the slice names", () => {
		const total = Object.values(CATEGORY_ID_VALIDATORS)
			.flatMap((fields) => Object.values(fields))
			.reduce((a, b) => a + b, 0);
		expect(total).toBe(13);
	});
});

describe("what they do to a device's UUID", () => {
	const uuid = randomUUID();

	it("z.cuid() refuses a UUID and a cuid-shaped id passes; v1's idSchema takes both", () => {
		expect(z.cuid().safeParse(uuid).success).toBe(false);
		expect(z.cuid().safeParse(`c${uuid.replaceAll("-", "")}`).success).toBe(
			true,
		);
		expect(idSchema.safeParse(uuid).success).toBe(true);
		expect(idSchema.safeParse(`c${uuid.replaceAll("-", "")}`).success).toBe(
			true,
		);
	});
});
