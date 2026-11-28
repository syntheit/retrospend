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
		arg: "where: { id, userId,",
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
		file: "src/server/services/category/create.mutation.ts",
		call: "delete",
		arg: "where: { id: source.id, userId }",
		reason: "deletes the locked source, which lockedCategory found by owner",
	},
	{
		file: "src/server/services/category/lock.ts",
		call: "raw",
		arg: '"userId" = ${userId} FOR UPDATE',
		reason: "the owner's row lock, userId in the filter",
	},
	{
		file: "src/server/services/shared-expenses/audit-category-name.ts",
		call: "findUnique",
		arg: "where: { id: categoryId }",
		reason: "reads the name only after shownCategoryPairs confirmed the (split, category) pair with category_shown_on_split; the log runs as the owner",
	},
	{
		file: "src/server/services/shared-expenses/remove-self.mutation.ts",
		call: "findMany",
		arg: "id: { in: input.removed",
		reason: "only asks which ids still exist, through the restorer's own scoped client, which sees the categories category_shared_read shows them; selects id only, no name leaves",
	},
	{
		file: "src/server/services/shared-expenses/snapshot.ts",
		call: "findMany",
		arg: "where: { id: { in: ids } }",
		reason: "only asks which ids still exist, through the restorer's own scoped client, which sees the categories category_shared_read shows them; selects id only, no name leaves",
	},
	{
		file: "src/server/services/project/public-totals.ts",
		call: "findMany",
		arg: "where: { id: { in: ids } }",
		reason: "public page: the ids come from loadPublicTotals lateral join, which already kept only categories on a split their owner created or is on",
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

/** Where a category id is written onto a row: a prisma write whose arguments name `categoryId` or connect a category. */
const WRITE = /\.(\w+)\.(create|createMany|update|updateMany|upsert|updateManyAndReturn)\s*\(/g;
const OWN_IMPORT = /category\/own"|from "\.\/own"|from "\.\.\/category\/own"/;

interface WriteHit {
	readonly file: string;
	readonly call: string;
	readonly imports: boolean;
}

function writeHits(): WriteHit[] {
	const found: WriteHit[] = [];
	for (const path of files(join(ROOT, "src/server"))) {
		const file = relative(ROOT, path);
		const text = readFileSync(path, "utf8");
		const imports = OWN_IMPORT.test(text);
		for (const m of text.matchAll(WRITE)) {
			const args = argsAt(text, (m.index ?? 0) + m[0].length);
			if (/\bcategoryId\b|category: \{ connect/.test(args))
				found.push({ file, call: `${m[1]}.${m[2]}`, imports });
		}
	}
	return found;
}

/** Writes of a category id in a file that does not go through own.ts, each with why it is safe. */
const WRITE_ALLOWED: readonly {
	readonly file: string;
	readonly calls: readonly string[];
	readonly reason: string;
}[] = [
	{
		file: "src/server/services/category/holders-budget.ts",
		calls: [
			"analyticsCategoryPreference.create",
			"analyticsCategoryPreference.updateMany",
			"analyticsCategoryPreference.update",
			"budget.createMany",
			"budget.updateManyAndReturn",
			"budget.updateMany",
			"envelopeCategory.create",
			"envelopeCategory.updateMany",
		],
		reason: "a merge moves the owner's rows between two of their categories; the target went through ownCategoryWhere in merge.mutation.ts, and an undo puts back ids the stash holds",
	},
	{
		file: "src/server/services/category/holders-rows.ts",
		calls: ["splitParticipant.updateManyAndReturn", "splitParticipant.updateMany"],
		reason: "a merge moves the owner's own shares to the owner's validated target; the where names participantId = the owner",
	},
	{
		file: "src/server/services/entry/expense-bulk.prisma.ts",
		calls: ["expense.updateMany"],
		reason: "setCategory runs after the bulk core asked port.category, which is expense-edit.prisma.ts's ownCategoryWhere lookup",
	},
	{
		file: "src/server/services/shared-expenses/remove-self.mutation.ts",
		calls: ["splitParticipant.createMany"],
		reason: "puts back the person's own removed share from a server-held, user-bound record, keeping a category only if it still exists",
	},
	{
		file: "src/server/services/shared-expenses/snapshot.ts",
		calls: ["sharedTransaction.create", "splitParticipant.createMany"],
		reason: "restores a deleted split from the creator's sealed, user-bound stash; an id the restorer cannot see is dropped, never invented",
	},
];

describe("category id writes", () => {
	const all = writeHits();

	it("finds the writes the search is about", () => {
		expect(all.filter((h) => h.imports).length).toBeGreaterThan(10);
	});

	it("each is in a file that goes through own.ts or is listed with a reason", () => {
		const loose = all
			.filter(
				(h) =>
					!h.imports &&
					!WRITE_ALLOWED.some((a) => a.file === h.file && a.calls.includes(h.call)),
			)
			.map((h) => `${h.file} ${h.call}`);
		expect(loose).toEqual([]);
	});

	it("every listed write still exists and is not in a file that now imports own.ts", () => {
		const stale = WRITE_ALLOWED.flatMap((a) =>
			a.calls
				.filter((c) => !all.some((h) => h.file === a.file && h.call === c && !h.imports))
				.map((c) => `${a.file} ${c}`),
		);
		expect(stale).toEqual([]);
		for (const a of WRITE_ALLOWED) expect(a.reason.length, a.file).toBeGreaterThan(20);
	});
});

const SHOWN = /withShownCategory|shownCategoryOf|shownCategoryPairs|category_shown_on_split/;

/** Files that read another person's category through a relation on a split and are not covered by the shown rule, with why. */
const READ_ALLOWED: readonly { readonly file: string; readonly reason: string }[] = [
	{ file: "src/server/services/shared-expense-integration.ts", reason: "reads the category's userId only, to hand a share its own category (ownExpenseCategoryId); no name leaves" },
	{ file: "src/server/services/sync/snapshots.ts", reason: "reads the category's userId only, for the person's own share (ownExpenseCategoryId); no name leaves" },
	{ file: "src/server/services/api-v1/shared-expenses-extras.ts", reason: "v1 callers are people on the scoped client, where category_shared_read applies" },
	{ file: "src/server/services/expense-list/rows.ts", reason: "the person's own expenses on their scoped client" },
	{ file: "src/server/services/export/person-csv.ts", reason: "an export a signed-in person runs on their scoped client (protectedProcedure, scopedDbFor)" },
	{ file: "src/server/services/export/person-pdf.ts", reason: "an export a signed-in person runs on their scoped client (protectedProcedure, scopedDbFor)" },
	{ file: "src/server/services/export/project-pdf.ts", reason: "an export a signed-in person runs on their scoped client (protectedProcedure, scopedDbFor)" },
	{ file: "src/server/services/export/project-csv.ts", reason: "an export a signed-in person runs on their scoped client (protectedProcedure, scopedDbFor)" },
	{ file: "src/server/services/shared-expenses/people.service.ts", reason: "called only by the people routers and v1 on the person's scoped client" },
	{ file: "src/server/services/project/page-figures.ts", reason: "types and figures over rows its callers already loaded and checked" },
];

describe("readers that bypass row level security", () => {
	const reads = (path: string, text: string) =>
		/category: (\{ ?select|true|categorySelect|tx\.category)|category: \{$/m.test(text) &&
		/sharedTransaction|splitParticipant|SharedTransaction/.test(text) &&
		!isTest(path);
	const inScope = files(join(ROOT, "src/server")).filter((p) =>
		reads(p, readFileSync(p, "utf8")),
	);

	it("finds the readers the search is about", () => {
		expect(inScope.length).toBeGreaterThan(10);
	});

	it("each asks the shown rule or is listed with a reason", () => {
		const loose = inScope
			.filter((p) => !SHOWN.test(readFileSync(p, "utf8")))
			.map((p) => relative(ROOT, p))
			.filter((f) => !READ_ALLOWED.some((a) => a.file === f));
		expect(loose).toEqual([]);
	});

	it("every listed reader still reads a category and does not already ask the rule", () => {
		const names = inScope.map((p) => relative(ROOT, p));
		const stale = READ_ALLOWED.filter(
			(a) =>
				!names.includes(a.file) ||
				SHOWN.test(readFileSync(join(ROOT, a.file), "utf8")),
		).map((a) => a.file);
		expect(stale).toEqual([]);
		for (const a of READ_ALLOWED) expect(a.reason.length, a.file).toBeGreaterThan(20);
	});
});
