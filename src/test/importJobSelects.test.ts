// Catches: a model call that returns a whole import job, file included (E2EE
// D11 Revision 3, PR 5). `import_job.fileData` is the uploaded file as base64,
// up to 14 MB. It is sealed at rest, so a call that does not name its columns
// opens all of it on the way out, and a create or update that returns the row
// hands it to the caller (the tRPC create used to return the job to the
// browser with its file). Every call that returns a job must name its columns
// (`select`) or leave the file out (`omit`), and only processQueue reads the
// file, in one findFirst.
//
// What it enforces: in `src` outside tests and fixtures, every
// `importJob.<find, create, update, upsert or delete>(...)` call has a
// top-level `select` or `omit`; an `omit` names `fileData`; and `fileData: true`
// appears in one call only (the queue's own read). A call through a relation
// (`user.importJobs`) is refused outright. Calls that return no row
// (`count`, `updateMany`, `deleteMany`) are not looked at. Not seen: a job
// read through a raw query or a variable that holds the arguments.
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
	scanSources,
	withoutComments,
	withoutCommentsAndStrings,
} from "./source-scan";
import { REPO_ROOT } from "./uiRules/paths";

const OPS =
	"findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|findMany|create|update|upsert|delete";
const CALL = new RegExp(
	`\\bimportJob\\s*\\.\\s*(${OPS})\\s*(?:<[^>]*>)?\\(`,
	"g",
);
const KEY = /^\s*(["']?)(\w+)\1\s*:/;

/** The only call that reads the file: processQueue's findFirst. */
const READS_FILE = "src/server/services/import-queue.service.ts";

interface Call {
	op: string;
	/** Top-level keys of the argument object, each with its value's text. */
	keys: Map<string, string>;
	text: string;
}

/** The calls on an import job in `source`. */
function importJobCalls(source: string): Call[] {
	const text = withoutComments(source);
	const blanked = withoutCommentsAndStrings(source);
	const calls: Call[] = [];
	for (const m of blanked.matchAll(CALL)) {
		const open = (m.index ?? 0) + m[0].length - 1;
		let depth = 0;
		let end = open;
		for (; end < blanked.length; end++) {
			const c = blanked[end];
			if (c === "(" || c === "{" || c === "[") depth++;
			else if (c === ")" || c === "}" || c === "]") {
				depth--;
				if (depth === 0) break;
			}
		}
		// Top-level keys: at depth 2 inside `(` and `{`, after `{` or `,`.
		const keys = new Map<string, string>();
		let level = 0;
		let from = -1;
		let name = "";
		const close = (to: number) => {
			if (name) keys.set(name, text.slice(from, to).trim());
			name = "";
		};
		for (let i = open; i <= end; i++) {
			const c = blanked[i];
			if (c === "(" || c === "{" || c === "[") {
				level++;
				if (level === 2 && c === "{") {
					from = i + 1;
					const k = KEY.exec(blanked.slice(from));
					if (k) {
						name = k[2] ?? "";
						from += k[0].length;
					}
				}
			} else if (c === ")" || c === "}" || c === "]") {
				if (level === 2) close(i);
				level--;
			} else if (c === "," && level === 2) {
				close(i);
				from = i + 1;
				const k = KEY.exec(blanked.slice(from));
				if (k) {
					name = k[2] ?? "";
					from += k[0].length;
				}
			}
		}
		calls.push({ op: m[1] ?? "", keys, text: text.slice(open, end + 1) });
	}
	return calls;
}

/** What is wrong with the call, or null. */
function problem(call: Call, file: string): string | null {
	const select = call.keys.get("select");
	const omit = call.keys.get("omit");
	if (select === undefined && omit === undefined)
		return `${call.op} names no select or omit`;
	if (omit !== undefined && !/\bfileData\b|\bNO_FILE\b/.test(omit))
		return `${call.op} has an omit that keeps fileData`;
	if (select !== undefined && /\bfileData\s*:\s*true\b/.test(select))
		return file === READS_FILE ? null : `${call.op} selects fileData`;
	return null;
}

describe("detector", () => {
	const found = (code: string) =>
		importJobCalls(code).map((c) => problem(c, "x.ts"));

	it("flags a call with no select or omit, through a client or a transaction", () => {
		expect(
			found(`await tx.importJob.findFirst({ where: { id } });
			await db.importJob.create({ data: { select: 1 } });
			await caller.db.importJob.update({ where: { id }, data: {} });`),
		).toEqual([
			"findFirst names no select or omit",
			"create names no select or omit",
			"update names no select or omit",
		]);
	});

	it("takes a select, or an omit of the file, at the top level", () => {
		expect(
			found(`db.importJob.findMany({ where: { a: 1 }, select: { id: true } });
			db.importJob.update({ where: { id }, omit: NO_FILE, data: {} });
			db.importJob.findFirst({ omit: { fileData: true }, where: { id } });`),
		).toEqual([null, null, null]);
	});

	it("does not take a select that is only inside a nested argument", () => {
		expect(
			found(
				`db.importJob.update({ where: { id }, data: { x: { select: 1 } } });`,
			),
		).toEqual(["update names no select or omit"]);
	});

	it("flags an omit that keeps the file and a select of it", () => {
		expect(
			found(`db.importJob.findFirst({ omit: { transactions: true } });
			db.importJob.findFirst({ select: { fileData: true } });`),
		).toEqual([
			"findFirst has an omit that keeps fileData",
			"findFirst selects fileData",
		]);
	});

	it("ignores comments, strings and calls that return no row", () => {
		expect(
			found(`// db.importJob.findFirst({ where: { id } })
			const s = "db.importJob.update({})";
			await db.importJob.updateMany({ data: {} });
			await db.importJob.count({ where: {} });`),
		).toEqual([]);
	});
});

describe("calls on an import job in the source", () => {
	const files = scanSources({
		roots: ["src"],
		include: /\.tsx?$/,
		exclude:
			/\.test\.tsx?$|[\\/]__tests__[\\/]|[\\/]src[\\/]test[\\/]|test-fixtures|test-utils/,
	});
	const rel = (f: string) => relative(REPO_ROOT, f).replaceAll("\\", "/");
	const calls = files.flatMap((f) =>
		importJobCalls(readFileSync(f, "utf8")).map((call) => ({
			file: rel(f),
			call,
		})),
	);

	it("finds the calls it should (the scan itself works)", () => {
		expect(calls.length).toBeGreaterThan(15);
		expect(calls.map((c) => c.file)).toContain(
			"src/server/services/api-v1/imports.ts",
		);
	});

	it("each name their columns or leave the file out", () => {
		expect(
			calls
				.map(({ file, call }) => {
					const why = problem(call, file);
					return why ? `${file}: ${why}` : null;
				})
				.filter(Boolean),
		).toEqual([]);
	});

	it("select the file in one place only: the queue's own read", () => {
		expect(
			calls
				.filter(({ call }) =>
					/\bfileData\s*:\s*true\b/.test(call.keys.get("select") ?? ""),
				)
				.map(({ file, call }) => `${file} ${call.op}`),
		).toEqual([`${READS_FILE} findFirst`]);
	});

	it("reach no job through a relation of the user", () => {
		const through = files.filter((f) =>
			/\bimportJobs\b/.test(withoutComments(readFileSync(f, "utf8"))),
		);
		expect(through.map(rel)).toEqual([]);
	});
});
