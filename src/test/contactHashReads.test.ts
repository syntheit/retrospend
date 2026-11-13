// Catches: a whole-row read of a ghost or a guest that would carry `emailHash`
// out of the server (E2EE D11 Revision 3, PR 3a). The hash is deterministic
// across the instance, so a client holding it could compare addresses of
// people it does not know. A Prisma call on `shadowProfile` or `guestSession`
// that returns a row (find, create, update, upsert, delete) must name `select`
// or `omit`, so what leaves is what the code chose; response-guard.ts checks
// the same in test-mode responses (`hasContactHash`). Counts and bulk writes
// return no row and are not looked at. It is a word match on `select:` or
// `omit:` anywhere in the call's arguments, not a type check. Not seen: a model
// reached through a variable that is not named `shadowProfile` or
// `guestSession`.
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { scanSources, withoutCommentsAndStrings } from "./source-scan";
import { REPO_ROOT } from "./uiRules/paths";

const CALL =
	/\b(shadowProfile|guestSession)\s*\.\s*(findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|findMany|create|update|upsert|delete)\s*(?:<[^>]*>)?\s*\(/g;

/** Whole-row calls that are fine, with why. A new entry needs a reason. */
const ALLOWED: { file: string; reason: string }[] = [];

/** The text of the call's arguments, from the opening parenthesis to its match. */
function argumentsAt(text: string, open: number): string {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (text[i] === "(") depth++;
		else if (text[i] === ")" && --depth === 0) return text.slice(open, i + 1);
	}
	return text.slice(open);
}

const NARROWS = /\b(select|omit)\s*:/;

function offenders(): string[] {
	const files = scanSources({
		roots: ["src", "scripts", "packages"],
		include: /\.(ts|tsx)$/,
		exclude:
			/(\.test\.|\.pg\.test\.|[\\/]__tests__[\\/]|[\\/]test[\\/]|test-utils|fixture)/,
	});
	const found: string[] = [];
	for (const file of files) {
		const source = withoutCommentsAndStrings(readFileSync(file, "utf8"));
		const path = relative(REPO_ROOT, file);
		if (ALLOWED.some((a) => a.file === path)) continue;
		for (const m of source.matchAll(CALL)) {
			const args = argumentsAt(source, (m.index ?? 0) + m[0].length - 1);
			if (!NARROWS.test(args)) {
				const line = source.slice(0, m.index).split("\n").length;
				found.push(`${path}:${line} ${m[1]}.${m[2]}`);
			}
		}
	}
	return found;
}

describe("contact hash reads", () => {
	it("no whole-row read or write return of a ghost or a guest outside the listed files", () => {
		expect(offenders()).toEqual([]);
	});

	it("sees a read without select and one with it", () => {
		const text = withoutCommentsAndStrings(
			"a.shadowProfile.findMany({ where: { id } }); b.guestSession.findFirst({ select: { id: true } })",
		);
		const calls = [...text.matchAll(CALL)].map((m) =>
			NARROWS.test(argumentsAt(text, (m.index ?? 0) + m[0].length - 1)),
		);
		expect(calls).toEqual([false, true]);
	});
});
