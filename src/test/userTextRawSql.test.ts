// Catches: raw SQL that reads a user-text column.
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
import { USER_TEXT_COLUMNS } from "./userTextColumns";

/** Every column word of the sealing map, generated (userTextColumns.ts). */
const COLUMNS = USER_TEXT_COLUMNS;
const READS_TEXT = new RegExp(`\\b(?:${COLUMNS.join("|")})\\b`);
const WORD = (column: string) => new RegExp(`\\b${column}\\b`);

/**
 * The audited files and the mapped columns each may name, with the audit
 * section that covers them. A new column in an audited file needs its own entry. The search ones
 * keep a SQL path for a database before the field encryption epoch; after it
 * they read text through model reads (search-fold.ts, `searchesInAppLoaded`).
 */
const AUDITED: { file: string; columns: string[]; reason: string }[] = [
	{
		file: "src/server/services/search.service.ts",
		columns: ["description", "location", "title"],
		reason: "expense search: SQL path, before the field encryption epoch",
	},
	{
		file: "src/server/services/expense-list/query-parts.ts",
		columns: [
			"description",
			"location",
			"note",
			"notes",
			"paymentMethod",
			"title",
		],
		reason: "Activity search: SQL path, before the field encryption epoch",
	},
	{
		file: "src/server/services/payments/confirm-restore.ts",
		columns: ["paymentMethod"],
		reason:
			"B14: payment confirm keeps the stored text in its audit entry, never opened there",
	},
	{
		file: "src/server/services/user-deletion-ghosts.ts",
		columns: ["email", "phone"],
		reason:
			"B15: a handed-over ghost has its sealed email and phone set to null by a prefix test, nothing is read",
	},
	{
		file: "src/server/services/keys/contact-hash-fill.ts",
		columns: ["email"],
		reason:
			"B16: the start's fill reads only plaintext shadow_profile and guest_session emails (a sealed one fails the prefix test), writes only emailHash, and the update repeats the plaintext equality",
	},
	{
		file: "src/server/services/payments/auto-finalize.ts",
		columns: ["changes"],
		reason:
			"B17: the audit changes key paymentGroupId is an id, not a sealed leaf (AUDIT_CHANGES_LEAVES)",
	},
	{
		file: "src/server/services/protection-keys/prelogin.ts",
		columns: ["email"],
		reason:
			"B18: joins user.email, which is not a mapped column (the sealed email columns are shadow_profile and guest_session)",
	},
];

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
	// "file column" for each mapped column word a tagged template names.
	const readers = files
		.flatMap((f) => {
			const bodies = templateBodies(readFileSync(f, "utf8"));
			const file = relative(REPO_ROOT, f).replaceAll("\\", "/");
			return COLUMNS.filter((c) => bodies.some((b) => WORD(c).test(b))).map(
				(c) => `${file} ${c}`,
			);
		})
		.sort();

	it("sits only in the audited files, for the audited columns", () => {
		expect(readers.join("\n")).toBe(
			AUDITED.flatMap((a) => a.columns.map((c) => `${a.file} ${c}`))
				.sort()
				.join("\n"),
		);
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
