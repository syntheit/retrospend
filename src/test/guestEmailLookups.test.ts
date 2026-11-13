// Catches: a lookup of a guest session by its `email` column (E2EE D11
// Revision 3, PR 4). Once the epoch is set `guest_session.email` is
// ciphertext with a random nonce, so an equality on it quietly finds nothing
// (and field-open.ts refuses the call). The one way to find a guest by address
// is `contactLookup("guest_session", address)` (keys/contact-hash.ts), which
// gives `{ emailHash }` or the case-insensitive plaintext match. This scan
// fails any `guestSession` call whose `where` names `email`. It covers every
// source file that is not a `*.test.ts` (test doubles and fixtures included),
// where tests assert state through an unsealed client. Not seen: a `where`
// built in a variable that is not written at the call, and a model reached
// through a name other than `guestSession`.
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { scanSources, withoutCommentsAndStrings } from "./source-scan";
import { REPO_ROOT } from "./uiRules/paths";

const CALL =
	/\bguestSession\s*\.\s*(findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|findMany|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)\s*(?:<[^>]*>)?\s*\(/g;

/** The text from `open` (an opening bracket) to its match. */
function balanced(text: string, open: number): string {
	const pairs: Record<string, string> = { "(": ")", "{": "}" };
	const stack: string[] = [];
	for (let i = open; i < text.length; i++) {
		const c = text[i] ?? "";
		if (pairs[c]) stack.push(pairs[c] ?? "");
		else if (c === stack[stack.length - 1] && stack.pop() && !stack.length)
			return text.slice(open, i + 1);
	}
	return text.slice(open);
}

/** True when a `where: { ... }` in the call's arguments names the `email` key. */
function wheresOnEmail(args: string): boolean {
	for (const m of args.matchAll(/\bwhere\s*:\s*(?=\{)/g)) {
		const body = balanced(args, (m.index ?? 0) + m[0].length);
		if (/\bemail\b/.test(body)) return true;
	}
	return false;
}

/** The calls in `source` (comments and strings already blanked) that filter on email. */
function lookups(source: string): number[] {
	const lines: number[] = [];
	for (const m of source.matchAll(CALL)) {
		const open = (m.index ?? 0) + m[0].length - 1;
		if (wheresOnEmail(balanced(source, open)))
			lines.push(source.slice(0, m.index).split("\n").length);
	}
	return lines;
}

describe("guest session lookups", () => {
	it("no where on guestSession.email remains outside contactLookup", () => {
		const files = scanSources({
			roots: ["src", "scripts", "packages"],
			include: /\.(ts|tsx)$/,
			exclude: /\.test\.tsx?$/,
		});
		const found = files.flatMap((file) =>
			lookups(withoutCommentsAndStrings(readFileSync(file, "utf8"))).map(
				(line) => `${relative(REPO_ROOT, file)}:${line}`,
			),
		);
		expect(found).toEqual([]);
	});

	it("sees an email filter at any depth and lets the hash and the lookup pass", () => {
		const text = withoutCommentsAndStrings(
			[
				"a.guestSession.findFirst({ where: { email, projectId } });",
				"a.guestSession.deleteMany({ where: { AND: [{ projectId }, { email: { equals: x } }] } });",
				"a.guestSession.findMany({ where: { emailHash: h }, select: { email: true } });",
				"a.guestSession.findFirst({ where: { ...sameAddress, projectId } });",
				"a.guestSession.deleteMany({ where: lookup });",
			].join("\n"),
		);
		expect(lookups(text)).toEqual([1, 2]);
	});
});
