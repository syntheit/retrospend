// What the tests that read the repository's own source share: the file walk,
// and a tokenizer that blanks comments (and, when asked, the text of strings)
// so a scan looks at code only. rawSqlScan.test.ts and rolled-back-sql.test.ts
// each bring their own rules.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./uiRules/paths";

const NEVER_ENTERED = new Set(["node_modules", "generated", "dist", ".next"]);

/**
 * The files under `roots` (directories relative to the repository root) whose
 * absolute path matches `include` and not `exclude`. Dependency, generated and
 * build output directories are never entered.
 */
export function scanSources(options: {
	roots: string[];
	include: RegExp;
	exclude?: RegExp;
}): string[] {
	const files: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!NEVER_ENTERED.has(entry.name)) walk(path);
			} else if (
				options.include.test(path) &&
				!(options.exclude?.test(path) ?? false)
			) {
				files.push(path);
			}
		}
	};
	for (const root of options.roots) walk(join(REPO_ROOT, root));
	return files;
}

/**
 * `text` with every comment blanked (newlines kept, so offsets and lines
 * hold). Strings and template literals, including `${}` inside a template,
 * are read as such, so `//` in "https://x" is not a comment. With `strings`,
 * the text inside strings and template literals is blanked too (the quotes
 * and the code inside `${}` stay), so a bracket or a keyword in a string
 * cannot be mistaken for code. A regex literal holding a quote can fool it
 * for the rest of its line.
 */
function blank(text: string, strings: boolean): string {
	const out = text.split("");
	// "}" closes a `${` and returns to template mode; "{" nests inside one.
	const modes: ("code" | "'" | '"' | "`")[] = ["code"];
	const braces: number[] = [];
	const blankRange = (from: number, to: number) => {
		for (let k = from; k < to; k++) if (text[k] !== "\n") out[k] = " ";
	};
	for (let i = 0; i < text.length; i++) {
		const mode = modes[modes.length - 1];
		const c = text[i];
		if (mode === "code") {
			if (c === "/" && text[i + 1] === "/") {
				const end = text.indexOf("\n", i);
				const stop = end === -1 ? text.length : end;
				blankRange(i, stop);
				i = stop - 1;
			} else if (c === "/" && text[i + 1] === "*") {
				const end = text.indexOf("*/", i + 2);
				const stop = end === -1 ? text.length : end + 2;
				blankRange(i, stop);
				i = stop - 1;
			} else if (c === '"' || c === "'" || c === "`") {
				modes.push(c);
			} else if (c === "{" && braces.length > 0) {
				braces.push((braces.pop() ?? 0) + 1);
			} else if (c === "}" && braces.length > 0) {
				const depth = braces.pop() ?? 0;
				if (depth === 0) modes.pop();
				else braces.push(depth - 1);
			}
		} else if (c === "\\") {
			if (strings) blankRange(i, i + 2);
			i++;
		} else if (c === mode || (c === "\n" && mode !== "`")) {
			// A quoted string ends at its line: an odd quote in a regex literal
			// does not swallow the rest of the file.
			modes.pop();
		} else if (mode === "`" && c === "$" && text[i + 1] === "{") {
			modes.push("code");
			braces.push(0);
			i++;
		} else if (strings) {
			blankRange(i, i + 1);
		}
	}
	return out.join("");
}

/** `text` with every comment blanked; strings stay. */
export function withoutComments(text: string): string {
	return blank(text, false);
}

/** `text` with every comment and the text of every string blanked. */
export function withoutCommentsAndStrings(text: string): string {
	return blank(text, true);
}
