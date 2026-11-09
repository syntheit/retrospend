// Catches: raw SQL that reads a user-text column (E2EE lane D10).
// Once field encryption is on, a column in USER_TEXT_FIELDS holds ciphertext,
// so SQL that matches, sorts, groups or compares it (or hands it to code that
// does not decrypt) is wrong. docs/security/user-text-sql-audit.md lists every
// reader and what happens to it. This test keeps that list true: outside tests,
// a tagged `$queryRaw`, `$executeRaw` or `Prisma.sql` template that names a
// user-text column may only sit in the files below, each audited there. A new
// reader needs an audit entry first, then a line here.
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { scanSources, withoutComments } from "./source-scan";
import { REPO_ROOT } from "./uiRules/paths";

/** Every column name declared through userText(), as a word. */
const COLUMNS = [
	"name",
	"title",
	"description",
	"notes",
	"note",
	"location",
	"label",
	"identifier",
	"message",
	"reply",
	"matchTitle",
	"paymentMethod",
	"paymentSource",
	"websiteUrl",
	"rejectionReason",
	"rejectedReason",
	"adminNote",
];
const READS_TEXT = new RegExp(`\\b(?:${COLUMNS.join("|")})\\b`);

/**
 * The audited files, with the audit section that covers them. The search ones
 * keep a SQL path for a database without field encryption and an app-layer path
 * for one with it (search-fold.ts, `searchesInApp`).
 */
const AUDITED: Record<string, string> = {
	"src/server/services/search.service.ts":
		"expense search: SQL path (no keyring) and app path (candidate read)",
	"src/server/services/expense-list/query-parts.ts":
		"Activity search: SQL path (no keyring)",
	"src/server/services/expense-list/search-scan.ts":
		"Activity search: app path, text read as raw columns and opened by readUserText",
};

const TAG = /(\$queryRaw|\$executeRaw|Prisma\.sql|\bsql)\s*(?:<[^>]*>)?\s*`/g;

/** The bodies of the tagged templates in `source`, nested ones included. */
function templateBodies(source: string): string[] {
	const text = withoutComments(source);
	const bodies: string[] = [];
	for (const m of text.matchAll(TAG)) {
		const start = (m.index ?? 0) + m[0].length;
		let depth = 0;
		let i = start;
		for (; i < text.length; i++) {
			const c = text[i];
			if (c === "\\") i++;
			else if (c === "$" && text[i + 1] === "{") {
				depth++;
				i++;
			} else if (c === "}" && depth > 0) depth--;
			else if (c === "`" && depth === 0) break;
		}
		bodies.push(text.slice(start, i));
	}
	return bodies;
}

describe("raw SQL that reads user text", () => {
	const files = scanSources({
		roots: ["src"],
		include: /\.tsx?$/,
		exclude: /\.test\.tsx?$|[\\/]__tests__[\\/]|[\\/]src[\\/]test[\\/]/,
	});
	const readers = files
		.filter((f) =>
			templateBodies(readFileSync(f, "utf8")).some((b) => READS_TEXT.test(b)),
		)
		.map((f) => relative(REPO_ROOT, f).replaceAll("\\", "/"))
		.sort();

	it("sits only in the audited files", () => {
		expect(readers).toEqual(Object.keys(AUDITED).sort());
	});

	it("finds the readers it should (the scan itself works)", () => {
		const body = templateBodies("x = tx.$queryRaw`SELECT e.title FROM e`");
		expect(body.some((b) => READS_TEXT.test(b))).toBe(true);
		expect(
			templateBodies("// tx.$queryRaw`SELECT title`").some((b) =>
				READS_TEXT.test(b),
			),
		).toBe(false);
		expect(
			templateBodies("tx.$queryRaw`SELECT id FROM ${Prisma.sql`x`}`").length,
		).toBe(2);
	});
});
