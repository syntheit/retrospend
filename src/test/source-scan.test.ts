import { describe, expect, it } from "vitest";
import {
	scanSources,
	withoutComments,
	withoutCommentsAndStrings,
} from "./source-scan";
import { REPO_ROOT } from "./uiRules/paths";

describe("withoutComments", () => {
	it("blanks comments, keeps strings, and keeps every offset and line", () => {
		const text = 'a(); // x\nb("// y"); /* z\nw */ c();';
		const out = withoutComments(text);
		expect(out).toHaveLength(text.length);
		expect(out).toBe('a();     \nb("// y");     \n     c();');
	});
});

describe("withoutCommentsAndStrings", () => {
	it("blanks the text of every kind of string and keeps the quotes and `${}` code", () => {
		const out = withoutCommentsAndStrings(
			"a('(x)'); b(\"}\"); c(`t(${f(')')})`); d('it\\'s');",
		);
		expect(out).toBe("a('   '); b(\" \"); c(`  ${f(' ')} `); d('     ');");
	});

	it("ends a quoted string at its line, so an odd quote in a regex does not swallow the rest", () => {
		const out = withoutCommentsAndStrings('x = /a"b/;\ny(")");');
		expect(out).toBe('x = /a"   \ny(" ");');
	});
});

describe("scanSources", () => {
	it("walks the roots, filters by include and exclude", () => {
		const files = scanSources({
			roots: ["src/test"],
			include: /\.test\.ts$/,
			exclude: /source-scan\.test\.ts$/,
		});
		expect(files.some((f) => f.endsWith("rawSqlScan.test.ts"))).toBe(true);
		expect(files.some((f) => f.endsWith("source-scan.test.ts"))).toBe(false);
		expect(files.every((f) => f.startsWith(`${REPO_ROOT}/src/test/`))).toBe(
			true,
		);
	});
});
