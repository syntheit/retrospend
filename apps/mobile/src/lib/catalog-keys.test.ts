import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadMessages } from "./i18n";

// Every literal t("key") under useTranslations(ns) must exist in the English
// catalog: a missing key throws MISSING_MESSAGE the moment its screen opens.

const ROOTS = ["src", "app"].map((d) => join(__dirname, "../..", d));

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sources(path);
		return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
			? [path]
			: [];
	});
}

function has(messages: unknown, path: string): boolean {
	let node = messages;
	for (const part of path.split(".")) {
		if (typeof node !== "object" || node === null || !(part in node))
			return false;
		node = (node as Record<string, unknown>)[part];
	}
	return node !== undefined;
}

const DECL = /(?:const|let)\s+(\w+)\s*=\s*useTranslations\(([^)]*)\)/g;
const CALL = /(?<![\w.])(\w+)(?:\.(?:rich|markup))?\(\s*(["'])([\w.-]+)\2/g;

describe("mobile catalog keys", () => {
	it("every literal t(key) under useTranslations(ns) resolves in en", () => {
		const english = loadMessages("en");
		const missing: string[] = [];
		for (const file of ROOTS.flatMap(sources)) {
			const text = readFileSync(file, "utf8");
			const decls = [...text.matchAll(DECL)].map((m) => ({
				name: m[1] as string,
				at: m.index ?? 0,
				// A ternary namespace names several; the key must exist in one.
				spaces: [...(m[2] ?? "").matchAll(/["'](mobile[\w.]*)["']/g)].map(
					(s) => s[1] as string,
				),
			}));
			for (const call of text.matchAll(CALL)) {
				const at = call.index ?? 0;
				const decl = decls.filter((d) => d.name === call[1] && d.at < at).pop();
				if (!decl || decl.spaces.length === 0) continue;
				const keys = decl.spaces.map((space) => `${space}.${call[3]}`);
				if (!keys.some((key) => has(english, key))) {
					const line = text.slice(0, at).split("\n").length;
					missing.push(`${file.split("apps/mobile/")[1]}:${line} ${keys[0]}`);
				}
			}
		}
		expect(missing).toEqual([]);
	});
});
