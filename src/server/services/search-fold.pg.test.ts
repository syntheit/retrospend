/**
 * The app-layer folds against the SQL they replaced, over every code point:
 * `immutable_unaccent` and `lower`. A Postgres upgrade that changes either
 * fails here instead of silently changing what search finds.
 */
import { describe, expect, it } from "vitest";
import { adminDb } from "~/test/pg-harness";
import { pgLower, unaccent } from "./search-fold";
import { UNACCENT_RULES } from "./search-unaccent-rules";

type Row = { cp: number; out: string };

describe("search folds match Postgres", () => {
	it("unaccent maps every code point the way immutable_unaccent does", async () => {
		const changed = await adminDb.$queryRaw<Row[]>`
			SELECT cp, public.immutable_unaccent(chr(cp)) AS out
			FROM generate_series(128, 1114111) cp
			WHERE cp NOT BETWEEN 55296 AND 57343
				AND public.immutable_unaccent(chr(cp)) <> chr(cp)`;
		expect(changed.length).toBeGreaterThan(1000);
		// Same set of changed characters, not only the same outputs.
		expect(changed).toHaveLength(UNACCENT_RULES.split("\n").length);
		for (const { cp, out } of changed)
			expect(unaccent(String.fromCodePoint(cp)), `U+${cp.toString(16)}`).toBe(
				out,
			);
	});

	it("pgLower lowercases Latin, Greek, Cyrillic and Georgian like lower()", async () => {
		// Newer scripts depend on the database's Unicode tables, so stop at
		// the ranges every supported Postgres image agrees on.
		const changed = await adminDb.$queryRaw<Row[]>`
			SELECT cp, lower(chr(cp)) AS out
			FROM generate_series(65, 8579) cp
			WHERE (cp <= 7304 OR cp >= 7312) AND lower(chr(cp)) <> chr(cp)`;
		expect(changed.length).toBeGreaterThan(800);
		const seen = new Set(changed.map((r) => r.cp));
		for (const { cp, out } of changed)
			expect(pgLower(String.fromCodePoint(cp)), `U+${cp.toString(16)}`).toBe(
				out,
			);
		for (let cp = 65; cp <= 8579; cp++) {
			if (cp > 7304 && cp < 7312) continue;
			if (!seen.has(cp))
				expect(pgLower(String.fromCodePoint(cp)), `U+${cp.toString(16)}`).toBe(
					String.fromCodePoint(cp),
				);
		}
	});
});
