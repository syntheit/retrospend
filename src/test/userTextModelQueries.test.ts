// Catches: a Prisma model query that filters, sorts or groups on a user-text
// column (E2EE lane D10). Once field encryption is on, those columns hold
// ciphertext with a random nonce, so `orderBy name`, `name contains`, `title
// equals` and `groupBy title` return nothing useful: the text has to be read,
// opened and compared in the app. userTextRawSql.test.ts guards raw SQL; this
// one guards the same thing through the Prisma client.
//
// What it enforces: in `src`, `scripts` and `packages`, outside tests, the
// argument of `where`, `orderBy`, `having`, `cursor`, `distinct` or `by` (and
// the object a variable named like `...where...` is set to) may not name one of
// the user-text column words, except in the places listed in ALLOWED, each with
// its reason. A word is "named" as an object key (`name: ...`, `"name":`), a
// shorthand key (`{ name }`) or a quoted string in `by` and `distinct`
// (`by: ["title"]`). It is a word match, not a type check, so a model with a
// column of that name that holds no user text (a token `identifier`) is listed
// too. A filter built outside those spots (a helper that returns a `where`
// piece under another name) is not seen.
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
	scanSources,
	withoutComments,
	withoutCommentsAndStrings,
} from "./source-scan";
import { REPO_ROOT } from "./uiRules/paths";

/** The column words of USER_TEXT_FIELDS (see userTextRawSql.test.ts). */
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
	// Import job text outside the declared fields (D11 Revision 3).
	"fileData",
	"errorMessage",
];
const WORD = COLUMNS.join("|");
const KEY = new RegExp(`(?:^|[{,\\s])["']?(${WORD})["']?\\s*:`, "g");
const SHORTHAND = new RegExp(`[{,]\\s*(${WORD})\\s*(?=[,}])`, "g");
const QUOTED = new RegExp(`["'](${WORD})["']`, "g");

const ARGS = /\b(where|orderBy|having|cursor|distinct|by)\s*:\s*(?=[{[])/g;
const WHERE_VAR = /\b\w*[Ww]here\w*\s*(?::[^=;]+)?=\s*(?=\{)/g;

/**
 * Known spots, by file and column word, each with why it is fine or who owns
 * it. A new reader needs a line here (and an entry in
 * docs/security/user-text-sql-audit.md) or a move to the app layer.
 */
const ALLOWED: { file: string; column: string; reason: string }[] = [
	{
		file: "src/server/services/title-suggestions.service.ts",
		column: "title",
		reason:
			"D6: SQL path used only without a keyring; the app path is beside it",
	},
	{
		file: "src/server/services/title-suggestions.service.ts",
		column: "description",
		reason: "D10: shared descriptions, same two paths as titles",
	},
	{
		file: "src/server/services/expense-duplicate.ts",
		column: "title",
		reason: "D7: SQL path used only without a keyring",
	},
	{
		file: "src/server/services/import/review.ts",
		column: "title",
		reason: "D8: SQL path used only without a keyring",
	},
	{
		file: "src/server/api/routers/auth.ts",
		column: "identifier",
		reason:
			"Token tables: identifier is an email address, not declared user text",
	},
	{
		file: "src/server/api/routers/guest.ts",
		column: "identifier",
		reason:
			"Token tables: identifier is an email address, not declared user text",
	},
	{
		file: "src/server/services/account-security.service.ts",
		column: "identifier",
		reason:
			"Token tables: identifier is an email address, not declared user text",
	},
];

type Hit = { file: string; column: string };

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

/** The column words named in the filter arguments of `source`. */
function namedColumns(source: string): string[] {
	const text = withoutComments(source);
	const blanked = withoutCommentsAndStrings(source);
	const found: string[] = [];
	const read = (start: number, quotedCounts: boolean) => {
		const end = closing(blanked, start);
		if (end < 0) return;
		const body = text.slice(start, end);
		// Nested keys of a `select` or a relation filter count too: they name the
		// column of the related model.
		for (const m of body.matchAll(KEY)) found.push(m[1] as string);
		for (const m of body.matchAll(SHORTHAND)) found.push(m[1] as string);
		if (quotedCounts)
			for (const m of body.matchAll(QUOTED)) found.push(m[1] as string);
	};
	for (const m of blanked.matchAll(ARGS)) {
		const key = m[1] as string;
		read((m.index ?? 0) + m[0].length, key === "by" || key === "distinct");
	}
	for (const m of blanked.matchAll(WHERE_VAR))
		read((m.index ?? 0) + m[0].length, false);
	return found;
}

describe("Prisma queries on user-text columns", () => {
	const files = scanSources({
		roots: ["src", "scripts", "packages"],
		include: /\.tsx?$/,
		exclude:
			/\.test\.tsx?$|[\\/]__tests__[\\/]|[\\/]src[\\/]test[\\/]|[\\/]node_modules[\\/]/,
	});
	const hits: Hit[] = [];
	for (const f of files) {
		const file = relative(REPO_ROOT, f).replaceAll("\\", "/");
		for (const column of new Set(namedColumns(readFileSync(f, "utf8"))))
			hits.push({ file, column });
	}
	const key = (h: Hit) => `${h.file} ${h.column}`;

	it("appear only in the listed places", () => {
		expect(hits.map(key).sort()).toEqual(ALLOWED.map(key).sort());
	});

	it("lists each allowed place once, with a reason", () => {
		expect(new Set(ALLOWED.map(key)).size).toBe(ALLOWED.length);
		expect(ALLOWED.every((a) => a.reason.length > 10)).toBe(true);
	});
});

describe("the scan sees the shapes the 17 model moves replaced", () => {
	const seen = (code: string) => namedColumns(code).sort();

	it("orderBy on a name, with a relation count first", () => {
		expect(
			seen(
				`db.category.findMany({ orderBy: [{ expenses: { _count: "desc" } }, { name: "asc" }] })`,
			),
		).toEqual(["name"]);
		expect(
			seen(`db.assetAccount.findMany({ orderBy: { name: "asc" } })`),
		).toEqual(["name"]);
		expect(seen(`x({ orderBy: [{ name: "asc" }, { id: "asc" }] })`)).toEqual([
			"name",
		]);
	});

	it("contains, equals and insensitive matches", () => {
		expect(
			seen(
				`x({ where: { OR: [{ name: { contains: q, mode: "insensitive" } }] } })`,
			),
		).toEqual(["name"]);
		expect(
			seen(`x({ where: { title: { equals: t, mode: "insensitive" } } })`),
		).toEqual(["title"]);
		expect(seen(`x({ where: { name: { gt: after.name }, id: 1 } })`)).toEqual([
			"name",
		]);
	});

	it("a plain equality filter, quoted or shorthand", () => {
		expect(
			seen(`x({ where: { userId, name: row.name, closedAt: null } })`),
		).toEqual(["name"]);
		expect(seen(`x({ where: { name: "Fees", kind: "EXPENSE" } })`)).toEqual([
			"name",
		]);
		expect(seen(`x({ where: { userId, name } })`)).toEqual(["name"]);
		expect(seen(`x({ where: { "title": t } })`)).toEqual(["title"]);
	});

	it("groupBy and distinct", () => {
		expect(seen(`x({ by: ["title"], _count: { title: true } })`)).toEqual([
			"title",
		]);
		expect(seen(`x({ distinct: ["title"] })`)).toEqual(["title"]);
	});

	it("a where built in a variable", () => {
		expect(seen(`const where: Prisma.X = { name: q }`)).toEqual(["name"]);
		expect(
			seen(`const clauseWhere = { OR: [{ description: { contains: q } }] }`),
		).toEqual(["description"]);
	});

	it("ignores text in comments and strings, and data writes", () => {
		expect(seen(`x({ where: { id } /* name: 1 */ })`)).toEqual([]);
		expect(seen(`x({ where: { kind: "name" } })`)).toEqual([]);
		expect(
			seen(`x({ data: { name: input.name }, select: { name: true } })`),
		).toEqual([]);
	});
});
