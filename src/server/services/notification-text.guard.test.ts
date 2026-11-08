import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Notification text is built in notification-text.ts from ids, kinds and
 * amounts. This reads the source of every place that makes one and fails
 * when it reaches for a title, a project name, a note or a hand-made number
 * (end-to-end encryption rule 3, AGENTS.md 6.1 and 6.4).
 */

const ROOT = join(__dirname, "..", "..", "..");
const SERVER = join(ROOT, "src", "server");

function sources(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory())
			return name === "__tests__" ? [] : sources(path);
		return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
	});
}

/** The text between the parentheses of each `<callee>(` in a file. */
function callArguments(source: string, callee: string): string[] {
	const found: string[] = [];
	let from = 0;
	for (;;) {
		const at = source.indexOf(`${callee}(`, from);
		if (at === -1) return found;
		from = at + callee.length + 1;
		if (/(function|async)\s+$/.test(source.slice(Math.max(0, at - 12), at)))
			continue;
		let depth = 1;
		let end = from;
		while (end < source.length && depth > 0) {
			const ch = source[end];
			if (ch === "(") depth++;
			else if (ch === ")") depth--;
			end++;
		}
		found.push(source.slice(from, end - 1));
	}
}

/** What a notice may never be made from. */
const FREE_TEXT =
	/\bdescription\b|\bprojectName\b|\bperiodLabel\b|\.title\b|\.notes\b|\.name\b|\bnotes\b|\btitle:|\bbody:/;
const HAND_FORMATTED = /\.toFixed\(|toLocaleString|\bIntl\./;

const files = sources(SERVER).map((path) => ({
	path: relative(ROOT, path),
	source: readFileSync(path, "utf8"),
}));

describe("notification text guard", () => {
	it("finds the places that make a notification", () => {
		const makers = files.filter(
			(f) => callArguments(f.source, "createNotification").length > 0,
		);
		expect(makers.length).toBeGreaterThanOrEqual(8);
	});

	it("no createNotification call passes a title, body, name or note", () => {
		const offenders = files.flatMap((f) =>
			callArguments(f.source, "createNotification")
				.filter((args) => FREE_TEXT.test(args) || HAND_FORMATTED.test(args))
				.map(() => f.path),
		);
		expect(offenders).toEqual([]);
	});

	it("no notification email is made from a name or a hand-written sentence", () => {
		const offenders = files.flatMap((f) =>
			callArguments(f.source, "notificationEmail")
				.filter(
					(args) =>
						/\.name\b|\bprojectName\b|\bdescription\b|`/.test(args) ||
						HAND_FORMATTED.test(args),
				)
				.map(() => f.path),
		);
		expect(offenders).toEqual([]);
	});

	it("the text module and the notification service format nothing by hand", () => {
		for (const path of [
			"src/server/services/notification-text.ts",
			"src/server/services/notifications.ts",
		]) {
			const source = files.find((f) => f.path === path)?.source ?? "";
			expect(source, path).not.toBe("");
			expect(HAND_FORMATTED.test(source), path).toBe(false);
			expect(
				/\bdescription\b|\bprojectName\b|\bperiodLabel\b/.test(source),
				path,
			).toBe(false);
		}
	});

	it("a notice, its data and its change summary have no field a title could ride in", () => {
		const source =
			files.find((f) => f.path === "src/server/services/notification-text.ts")
				?.source ?? "";
		const fieldsOf = (name: string) => {
			const body = new RegExp(
				`export interface ${name} \\{([\\s\\S]*?)\\n\\}`,
			).exec(source)?.[1];
			expect(body, name).toBeDefined();
			return [...(body ?? "").matchAll(/^\t(\w+)\??:/gm)].map((m) => m[1]);
		};
		expect(fieldsOf("Notice").sort()).toEqual([
			"actor",
			"amount",
			"changes",
			"hasLink",
			"kind",
			"total",
		]);
		expect(fieldsOf("NoticeChanges").sort()).toEqual([
			"amount",
			"category",
			"date",
			"other",
			"payer",
			"project",
			"split",
		]);
		for (const field of fieldsOf("NoticeData"))
			expect(field, field).toMatch(/Id$|Ids$|Type$|^kind$/);
	});
});
