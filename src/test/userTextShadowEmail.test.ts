// Catches: a filter, sort or group on a ghost's email (E2EE D11 Revision 3,
// PR 3b). `shadow_profile.email` is the creator's sealed text, so once the
// field encryption epoch is set Postgres would compare ciphertext with a
// random nonce and quietly miss every row. A ghost is found by address only
// through `contactLookup` (services/keys/contact-hash.ts: the hash, or the
// normalized plaintext before the epoch), which builds its `where` outside any
// `shadowProfile` call. This scan fails any `shadowProfile` call, or filter of
// the User relations `createdShadowProfiles` and `claimedShadowProfiles`, whose
// `where`, `orderBy`, `cursor`, `distinct`, `having` or `by` names `email`, in
// `src`, `scripts` and `packages`, outside tests but including the in-memory
// test double (shared-expenses/test-utils.ts), which must not learn an email
// filter the real client refuses. The runtime refusal in sealed-filters.ts
// backs it up. It is a word match on the arguments, not a type check; a filter
// assembled in a variable is not seen.
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
	scanSources,
	withoutComments,
	withoutCommentsAndStrings,
} from "./source-scan";
import { REPO_ROOT } from "./uiRules/paths";

const CALL = /\bshadowProfile\s*\.\s*\w+\s*(?:<[^>]*>)?\s*\(/g;
const RELATION = /\b(?:createdShadowProfiles|claimedShadowProfiles)\s*:\s*\{/g;
const FILTER_KEYS = new Set([
	"where",
	"orderBy",
	"cursor",
	"distinct",
	"having",
	"by",
]);
const EMAIL = /\bemail\b/;

/** The index just past the bracket that closes the one at `open`, or -1. */
function closing(blanked: string, open: number): number {
	let depth = 0;
	for (let i = open; i < blanked.length; i++) {
		const c = blanked[i];
		if (c === "{" || c === "[" || c === "(") depth++;
		else if (c === "}" || c === "]" || c === ")") {
			depth--;
			if (depth === 0) return i + 1;
		}
	}
	return -1;
}

/** The depth-one `key: value` pieces of the object literal that starts at `open`, by offsets. */
function properties(
	blanked: string,
	open: number,
	end: number,
): { key: string; from: number; to: number }[] {
	const found: { key: string; from: number; to: number }[] = [];
	let depth = 0;
	let start = open + 1;
	const push = (to: number) => {
		const piece = blanked.slice(start, to);
		const colon = piece.indexOf(":");
		const key = (colon < 0 ? piece : piece.slice(0, colon)).trim();
		if (key) found.push({ key, from: start + colon + 1, to });
	};
	for (let i = open; i < end; i++) {
		const c = blanked[i];
		if (c === "{" || c === "[" || c === "(") depth++;
		else if (c === "}" || c === "]" || c === ")") {
			depth--;
			if (depth === 0) push(i);
		} else if (c === "," && depth === 1) {
			push(i);
			start = i + 1;
		}
	}
	return found;
}

/** Offsets in `source` where a ghost's email is named in a filter, as line numbers. */
function emailFilters(source: string): number[] {
	const text = withoutComments(source);
	const blanked = withoutCommentsAndStrings(source);
	const lines: number[] = [];
	const line = (at: number) => text.slice(0, at).split("\n").length;
	for (const m of blanked.matchAll(CALL)) {
		const paren = (m.index ?? 0) + m[0].length - 1;
		const brace = blanked.slice(paren + 1).search(/\S/) + paren + 1;
		if (blanked[brace] !== "{") continue;
		const end = closing(blanked, brace);
		for (const p of properties(blanked, brace, end))
			if (FILTER_KEYS.has(p.key) && EMAIL.test(text.slice(p.from, p.to)))
				lines.push(line(p.from));
	}
	for (const m of blanked.matchAll(RELATION)) {
		const open = (m.index ?? 0) + m[0].length - 1;
		const end = closing(blanked, open);
		if (EMAIL.test(text.slice(open, end))) lines.push(line(open));
	}
	return lines;
}

describe("a ghost is never filtered by its email", () => {
	it("in any model call or relation filter outside the listed lookups", () => {
		const files = scanSources({
			roots: ["src", "scripts", "packages"],
			include: /\.tsx?$/,
			exclude:
				/\.test\.tsx?$|[\\/]__tests__[\\/]|[\\/]src[\\/]test[\\/]|[\\/]node_modules[\\/]/,
		});
		const offenders = files.flatMap((file) =>
			emailFilters(readFileSync(file, "utf8")).map(
				(line) => `${relative(REPO_ROOT, file)}:${line}`,
			),
		);
		expect(offenders).toEqual([]);
	});

	it("covers the in-memory test double of the shared expense tests", () => {
		const files = scanSources({
			roots: ["src/server/services/shared-expenses"],
			include: /test-utils\.ts$/,
		});
		expect(files).toHaveLength(1);
	});

	it("sees an email in a where, an orderBy and a relation, and not in a select or data", () => {
		const seen = (code: string) => emailFilters(code).length;
		expect(
			seen("db.shadowProfile.findMany({ where: { email: x, claimedById: null } })"),
		).toBe(1);
		expect(
			seen(
				"db.shadowProfile.findFirst({ where: { OR: [{ email: { equals: x, mode: 'insensitive' } }] } })",
			),
		).toBe(1);
		expect(
			seen("tx.shadowProfile.findMany({ orderBy: { email: 'asc' } })"),
		).toBe(1);
		expect(
			seen("db.shadowProfile.count({ where: { id: 1 }, select: undefined })"),
		).toBe(0);
		expect(
			seen(
				"db.user.findMany({ where: { createdShadowProfiles: { some: { email: x } } } })",
			),
		).toBe(1);
		expect(
			seen(
				"db.shadowProfile.create({ data: { email: x }, select: { email: true } })",
			),
		).toBe(0);
		expect(
			seen("db.shadowProfile.findMany({ select: { id: true, email: true } })"),
		).toBe(0);
		expect(seen("// db.shadowProfile.findMany({ where: { email } })")).toBe(0);
	});
});
