import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parseStoredNotice } from "./notification-text";

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

	it("a stored notice holds only ids, codes and minor amounts", () => {
		const money = { minor: 1_234_550, currency: "ARS" };
		const smuggle = { name: "Ana", title: "Cena", note: "x" };
		const parsed = parseStoredNotice({
			kind: "expenseEdited",
			actor: { type: "user", id: "u1", ...smuggle },
			amount: { money: { ...money, ...smuggle }, currencies: 2, offset: true },
			total: { ...money, ...smuggle },
			hasLink: true,
			changes: {
				amount: { from: money, to: { ...money, ...smuggle } },
				date: true,
				payer: true,
				split: true,
				category: true,
				project: true,
				other: true,
				...smuggle,
			},
			...smuggle,
		});
		expect(parsed).not.toBeNull();
		const strings: string[] = [];
		const walk = (value: unknown, path: string) => {
			if (typeof value === "string") strings.push(path);
			else if (value && typeof value === "object")
				for (const [key, inner] of Object.entries(value))
					walk(inner, path ? `${path}.${key}` : key);
		};
		walk(parsed, "");
		// Every text leaf is a kind, an id or a code; a smuggled title, name or
		// note is dropped when the notice is read back.
		expect(strings.sort()).toEqual([
			"actor.id",
			"actor.type",
			"amount.money.currency",
			"changes.amount.from.currency",
			"changes.amount.to.currency",
			"kind",
			"total.currency",
		]);
		expect(JSON.stringify(parsed)).not.toMatch(/Ana|Cena/);
		expect(parseStoredNotice({ kind: "nonsense" })).toBeNull();
		expect(
			parseStoredNotice({ kind: "periodClosed", amount: { money: { minor: 1.5, currency: "ARS" } } }),
		).toBeNull();
	});

	it("createNotification stores no text: title and body are empty, the notice goes in data", () => {
		const source =
			files.find((f) => f.path === "src/server/services/notifications.ts")
				?.source ?? "";
		expect(source).toMatch(/title: "",\s+body: "",/);
		expect(source).toMatch(/\bnotice,\s*\};/);
		// The notice stored is the parsed one, never the caller's object.
		expect(source).toMatch(/const notice = parseStoredNotice\(params\.notice\)/);
	});
});
