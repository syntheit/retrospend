// Money arithmetic ratchet (docs/roadmap/money-decimal.md, D5). Money math is
// exact Decimal (`@retrospend/domain/money-dec`); a float or Prisma's Decimal
// (20 digits, half up) in a figure loses cents. Two counts per file of money
// code, compared with arithmetic-baseline.json:
//
// - number: `Number(` whose argument names a money value (amount, balance,
//   total, ...InUSD). Some are display edges; each is classified as its area
//   moves to Decimal.
// - prisma-decimal: decimal arithmetic (div, mul, plus, minus, toDecimalPlaces
//   and their aliases) in a file that handles Prisma's Decimal. Prisma's
//   Decimal stays at the database boundary and crosses into Dec by string, so
//   arithmetic belongs in files that never see it.
//
// A count above the baseline fails with file:line. A count below it fails too,
// so the baseline always says where things stand: lower it in the same commit.
// The baseline only goes down; raising it is a review blocker, never a fix.
// money.ts is left out: its number wrappers are the declared display edge.
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { scanSources, withoutComments } from "../source-scan";
import { REPO_ROOT } from "../uiRules/paths";
import baseline from "./arithmetic-baseline.json";

type Counts = Record<string, Record<string, number>>;

const NUMBER = /\bNumber\([^)\n]*(?:amount|balance|total|inusd)/gi;
const DECIMAL_MATH =
	/\.(?:div|dividedBy|mul|times|plus|minus|sub|toDecimalPlaces|toDP)\(/g;
const PRISMA_DECIMAL =
	/\bPrisma\.Decimal\b|import[^;]*\bDecimal\b[^;]*from\s*["']@prisma\/client/;

/** Line numbers of every match of `pattern` in `text`. */
function linesOf(text: string, pattern: RegExp): number[] {
	return [...text.matchAll(pattern)].map(
		(m) => text.slice(0, m.index).split("\n").length,
	);
}

/** Every rule's hits in one file's source, by line. */
function hitsIn(source: string): Record<string, number[]> {
	const code = withoutComments(source);
	return {
		number: linesOf(code, NUMBER),
		"prisma-decimal": PRISMA_DECIMAL.test(code)
			? linesOf(code, DECIMAL_MATH)
			: [],
	};
}

function scan(): { counts: Counts; lines: Record<string, string[]> } {
	const files = scanSources({
		roots: ["src/server", "packages/domain/src", "packages/engine/src"],
		include: /\.tsx?$/,
		exclude:
			/\.test\.tsx?$|__tests__|test-fixtures|packages\/domain\/src\/money\.ts$/,
	});
	const counts: Counts = {};
	const lines: Record<string, string[]> = {};
	for (const path of files) {
		const file = relative(REPO_ROOT, path).split("\\").join("/");
		for (const [rule, at] of Object.entries(
			hitsIn(readFileSync(path, "utf8")),
		)) {
			if (at.length === 0) continue;
			counts[rule] = { ...counts[rule], [file]: at.length };
			lines[`${rule} ${file}`] = at.map((n) => `${file}:${n}`);
		}
	}
	return { counts, lines };
}

describe("money arithmetic ratchet", () => {
	it("each rule catches what it names and nothing else", () => {
		const number = (s: string) => hitsIn(s).number.length;
		expect(number("const v = Number(row.amountInUSD);")).toBe(1);
		expect(number("Number(s.shareAmount.toString())")).toBe(1);
		expect(number("const n = Number(row.count);")).toBe(0);
		expect(number("// Number(row.amount) in a comment")).toBe(0);

		const prisma = (s: string) => hitsIn(s)["prisma-decimal"].length;
		const header =
			'import { Prisma } from "~prisma";\nconst d: Prisma.Decimal = x;\n';
		expect(prisma(`${header}d.div(rate).toDecimalPlaces(2);`)).toBe(2);
		expect(
			prisma(
				'import type { Decimal } from "@prisma/client/runtime/index-browser";\nv.mul(r);',
			),
		).toBe(1);
		// Dec arithmetic in a file that never sees Prisma's Decimal is the goal.
		expect(
			prisma(
				'import { dec } from "@retrospend/domain/precise-decimal";\ndec(a).div(b);',
			),
		).toBe(0);
	});

	it("stays at the baseline", () => {
		const { counts, lines } = scan();
		const base = baseline as Counts;
		const problems: string[] = [];
		for (const rule of new Set([
			...Object.keys(counts),
			...Object.keys(base),
		])) {
			const files = new Set([
				...Object.keys(counts[rule] ?? {}),
				...Object.keys(base[rule] ?? {}),
			]);
			for (const file of [...files].sort()) {
				const now = counts[rule]?.[file] ?? 0;
				const was = base[rule]?.[file] ?? 0;
				if (now > was)
					problems.push(
						`${rule} ${file}: ${now}, baseline ${was}. Use money-dec instead.\n    ${(lines[`${rule} ${file}`] ?? []).join("\n    ")}`,
					);
				else if (now < was)
					problems.push(
						`${rule} ${file}: ${now}, baseline ${was}. Lower arithmetic-baseline.json to ${now}${now === 0 ? " (remove the entry)" : ""}.`,
					);
			}
		}
		expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
	});
});
