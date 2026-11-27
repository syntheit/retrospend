/**
 * Every lookup of a category by id goes through ownCategoryWhere (own.ts), so
 * "a category reference is the actor's own" is written once. Row level security
 * is no stand-in: a person on a split can read the owner's category, so a bare
 * `where: { id }` sees it. The search covers client calls (`.category.find...`
 * and writes by id) and raw SQL on the table in src/server. A hit without
 * ownCategoryWhere is allowed only when listed here with the reason it is safe,
 * keyed by file, call and the text of its arguments, and a listed entry that
 * matches nothing fails (so the list cannot rot).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../../../..");
const CALL =
	/\.category\s*\.\s*(findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow|findMany|count|update|updateMany|updateManyAndReturn|delete|deleteMany|aggregate|groupBy)\s*\(/g;
const RAW = /(FROM|JOIN|UPDATE|INTO)\s+"category"/g;

interface Allowed {
	readonly file: string;
	readonly call: string;
	/** A piece of the call's arguments (whitespace folded). */
	readonly arg: string;
	readonly reason: string;
}

const ALLOWED: readonly Allowed[] = [
	{
		file: "src/server/services/category-name-index.service.ts",
		call: "update",
		arg: "where: { id: row.id, userId }",
		reason: "writes the index of a row just read for this user, userId in the filter",
	},
	{
		file: "src/server/services/category.service.ts",
		call: "update",
		arg: "where: { id, userId }",
		reason: "the owner's own edit, userId in the filter",
	},
	{
		file: "src/server/services/category.service.ts",
		call: "findMany",
		arg: "where: { userId, ...(exceptId",
		reason: "the owner's own names for the name check; id only excludes one row",
	},
	{
		file: "src/server/services/category/merge.mutation.ts",
		call: "delete",
		arg: "where: { id: source.id, userId }",
		reason: "deletes the locked source, which lockedCategory found by owner",
	},
	{
		file: "src/server/services/category/merge.mutation.ts",
		call: "raw",
		arg: '"userId" = ${userId} FOR UPDATE',
		reason: "the owner's row lock, userId in the filter",
	},
	{
		file: "src/server/services/shared-expenses/audit-log-formatter.ts",
		call: "findUnique",
		arg: "where: { id: categoryId }",
		reason: "reads a name for an audit line through the viewer's client, so category_shared_read decides who sees it (K7)",
	},
	{
		file: "src/server/services/shared-expenses/remove-self.mutation.ts",
		call: "findMany",
		arg: "id: { in: input.removed",
		reason: "only asks which ids still exist, through the restorer's client (K7 rows); no name or field leaves",
	},
	{
		file: "src/server/services/shared-expenses/snapshot.ts",
		call: "findMany",
		arg: "where: { id: { in: ids } }",
		reason: "only asks which ids still exist, through the restorer's client (K7 rows); no name or field leaves",
	},
	{
		file: "src/server/services/project/page-view.ts",
		call: "findMany",
		arg: "where: { id: { in: ids } }",
		reason: "public page: the ids come from loadPublicTotals's lateral join, which already kept only categories on a split their owner created or is on",
	},
	{
		file: "src/server/services/project/page-view.ts",
		call: "raw",
		arg: 'FROM "category" c',
		reason: "the lateral join that applies the K7 rule for the public page (see the page's pg test)",
	},
	{
		file: "src/server/services/keys/field-encryption-start.ts",
		call: "raw",
		arg: 'FROM "category" WHERE "nameIndex" IS NULL',
		reason: "start check across all users, reads no id",
	},
];

const SKIP = new Set(["node_modules", "generated", ".next"]);
const isTest = (p: string) =>
	/\.test\.tsx?$|__tests__|test-support|test-fixtures|-kit\.ts$|test-utils/.test(p);

function files(dir: string, out: string[] = []): string[] {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (SKIP.has(e.name)) continue;
		const full = join(dir, e.name);
		if (e.isDirectory()) files(full, out);
		else if (/\.tsx?$/.test(e.name) && !isTest(full)) out.push(full);
	}
	return out;
}

/** The text between the call's parentheses. */
function argsAt(text: string, open: number): string {
	let depth = 1;
	let i = open;
	while (depth > 0 && i < text.length) {
		const c = text[i++];
		if (c === "(") depth++;
		else if (c === ")") depth--;
	}
	return text.slice(open, i - 1).replace(/\s+/g, " ");
}

interface Hit {
	readonly file: string;
	readonly call: string;
	readonly args: string;
}

function hits(): Hit[] {
	const found: Hit[] = [];
	for (const path of files(join(ROOT, "src/server"))) {
		const file = relative(ROOT, path);
		const text = readFileSync(path, "utf8");
		for (const m of text.matchAll(CALL))
			found.push({
				file,
				call: m[1] as string,
				args: argsAt(text, (m.index ?? 0) + m[0].length),
			});
		for (const m of text.matchAll(RAW))
			found.push({
				file,
				call: "raw",
				args: text.slice(m.index ?? 0, (m.index ?? 0) + 160).replace(/\s+/g, " "),
			});
	}
	return found;
}

/** Looks a category up by id: a filter on `id`, or a raw statement. */
const whereOf = (args: string) =>
	args.split(/\b(?:select|data|orderBy|include)\s*:/)[0] ?? "";
const byId = (h: Hit) =>
	h.call === "raw" || /\bid\b\s*[:,}]/.test(whereOf(h.args));
const allowed = (h: Hit) =>
	ALLOWED.some(
		(a) => a.file === h.file && a.call === h.call && h.args.includes(a.arg),
	);

describe("category lookups by id", () => {
	const all = hits();

	it("finds the call sites the search is about", () => {
		expect(all.filter((h) => h.args.includes("ownCategoryWhere(")).length).toBeGreaterThan(
			12,
		);
	});

	it("each goes through ownCategoryWhere or is listed with a reason", () => {
		const loose = all
			.filter((h) => byId(h) && !h.args.includes("ownCategoryWhere(") && !allowed(h))
			.map((h) => `${h.file} ${h.call}: ${h.args.slice(0, 100)}`);
		expect(loose).toEqual([]);
	});

	it("every listed exception still matches a call", () => {
		const stale = ALLOWED.filter(
			(a) => !all.some((h) => a.file === h.file && a.call === h.call && h.args.includes(a.arg)),
		).map((a) => `${a.file} ${a.call}: ${a.arg}`);
		expect(stale).toEqual([]);
		for (const a of ALLOWED) expect(a.reason.length, a.file).toBeGreaterThan(20);
	});
});
