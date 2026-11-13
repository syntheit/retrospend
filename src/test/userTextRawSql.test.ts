// Catches: raw SQL that reads a user-text column (E2EE lane D10).
// Once field encryption is on, a column in USER_TEXT_FIELDS holds ciphertext,
// so SQL that matches, sorts, groups or compares it (or hands it to code that
// does not decrypt) is wrong. docs/security/user-text-sql-audit.md lists every
// reader and what happens to it. This test keeps that list true: outside tests,
// a tagged `$queryRaw`, `$executeRaw` or `Prisma.sql` template in `src`,
// `scripts` or `packages` that names a user-text column may only sit in the
// files below, each audited there. A new reader needs an audit entry first,
// then a line here. Not seen: SQL passed as a plain string (a pg client query,
// as in scripts/scan-control-chars.ts, audited as B12) and Go. Model queries
// are guarded by userTextModelQueries.test.ts.
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
	"receiptUrl",
	"rejectionReason",
	"rejectedReason",
	"adminNote",
];
const READS_TEXT = new RegExp(`\\b(?:${COLUMNS.join("|")})\\b`);

/**
 * The audited files, with the audit section that covers them. The search ones
 * keep a SQL path for a database before the field encryption epoch; after it
 * they read text through model reads (search-fold.ts, `searchesInAppLoaded`).
 */
const AUDITED: Record<string, string> = {
	"src/server/services/search.service.ts":
		"expense search: SQL path, before the field encryption epoch",
	"src/server/services/expense-list/query-parts.ts":
		"Activity search: SQL path, before the field encryption epoch",
	"src/server/services/payments/confirm-restore.ts":
		"B14: payment confirm keeps the stored text in its audit entry, never opened there",
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
		roots: ["src", "scripts", "packages"],
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
