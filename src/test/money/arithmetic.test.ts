// Money arithmetic ratchet (docs/roadmap/money-decimal.md, D5). Money math is
// exact Decimal (`@retrospend/domain/money-dec`); a float or Prisma's Decimal
// (20 digits, half up) in a figure loses cents. Two counts per file of money
// code, compared with arithmetic-baseline.json:
//
// - float: a money value leaving Decimal for a float. `Number(` whose
//   argument names a money value (amount, balance, total, ...InUSD), any
//   `.toNumber()` or `parseFloat(`, and unary `+` on a Decimal. Some are
//   display edges; each is classified as its area moves to Decimal.
// - prisma-decimal: an arithmetic or rounding call (div, mul, plus,
//   toDecimalPlaces, toFixed, round, ...) whose receiver's type is Prisma's
//   Decimal. Prisma's Decimal stays at the database boundary and crosses into
//   Dec by string.
//
// Types come from the TypeScript API over the root tsconfig (the native
// compiler, well under a second for the money code). A count above the
// baseline fails with file:line. A count below it fails too, so the baseline
// always says where things stand: lower it in the same commit. The baseline
// only goes down; raising it is a review blocker, never a fix. money.ts is
// left out: its number wrappers are the declared display edge.
import { join } from "node:path";
import {
	type Node,
	type PrefixUnaryExpression,
	type PropertyAccessExpression,
	SyntaxKind,
} from "typescript/unstable/ast";
import {
	isCallExpression,
	isPrefixUnaryExpression,
	isPropertyAccessExpression,
} from "typescript/unstable/ast/is";
import { API, type Type } from "typescript/unstable/sync";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanSources, withoutComments } from "../source-scan";
import { REPO_ROOT } from "../uiRules/paths";
import baseline from "./arithmetic-baseline.json";

type Rule = "float" | "prisma-decimal";
type Counts = Partial<Record<Rule, Record<string, number>>>;
type Project = ReturnType<
	ReturnType<API["updateSnapshot"]>["getProjects"]
>[number];

const FLOAT_TEXT =
	/\bNumber\([^)\n]*(?:amount|balance|total|inusd)|\.toNumber\(\)|\bparseFloat\(/gi;
const METHODS = new Set(
	"plus add minus sub mul times div dividedBy idiv dividedToIntegerBy mod pow sqrt abs neg negated round ceil floor trunc toDecimalPlaces toDP toFixed toSignificantDigits toSD toNearest".split(
		" ",
	),
);
const declaredIn = (type: Type | undefined, file: RegExp): boolean =>
	!!type &&
	(type.isUnionType()
		? type.getTypes().some((t) => declaredIn(t, file))
		: file.test(type.getSymbol()?.declarations?.[0]?.path ?? ""));
const PRISMA_DECIMAL =
	/@prisma\/client-runtime-utils\/|@prisma\/client\/runtime\//;
const ANY_DECIMAL =
	/decimal\.js\/|@prisma\/client-runtime-utils\/|@prisma\/client\/runtime\//;

let api: API;
let project: Project;

beforeAll(() => {
	api = new API({ cwd: REPO_ROOT });
	const [first] = api
		.updateSnapshot({ openProjects: [join(REPO_ROOT, "tsconfig.json")] })
		.getProjects();
	if (!first) throw new Error("The TypeScript API opened no project");
	project = first;
}, 60_000);

afterAll(() => api?.close());

const lineAt = (text: string, offset: number) =>
	text.slice(0, offset).split("\n").length;

/** Every rule's hits in one file, by line. */
function hitsIn(path: string): Record<Rule, number[]> {
	const file = project.program.getSourceFile(path);
	if (!file) throw new Error(`${path} is not in the root tsconfig`);
	const code = withoutComments(file.text);
	const float = [...code.matchAll(FLOAT_TEXT)].map((m) =>
		lineAt(code, m.index),
	);
	const calls: PropertyAccessExpression[] = [];
	const pluses: PrefixUnaryExpression[] = [];
	const visit = (node: Node): void => {
		if (
			isCallExpression(node) &&
			isPropertyAccessExpression(node.expression) &&
			METHODS.has(node.expression.name.text)
		)
			calls.push(node.expression);
		if (isPrefixUnaryExpression(node) && node.operator === SyntaxKind.PlusToken)
			pluses.push(node);
		node.forEachChild(visit);
	};
	visit(file);
	const { checker } = project;
	const types = checker.getTypeAtLocation([
		...calls.map((c) => c.expression),
		...pluses.map((p) => p.operand),
	]);
	const prisma = calls
		.filter((_, i) => declaredIn(types[i], PRISMA_DECIMAL))
		.map((c) => lineAt(file.text, c.end));
	pluses.forEach((p, i) => {
		if (declaredIn(types[calls.length + i], ANY_DECIMAL))
			float.push(lineAt(file.text, p.pos + 1));
	});
	return { float, "prisma-decimal": prisma };
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
		const file = path.slice(REPO_ROOT.length).replace(/^\//, "");
		for (const [rule, at] of Object.entries(hitsIn(path)) as [
			Rule,
			number[],
		][]) {
			if (at.length === 0) continue;
			counts[rule] = { ...counts[rule], [file]: at.length };
			lines[`${rule} ${file}`] = at
				.sort((a, b) => a - b)
				.map((n) => `${file}:${n}`);
		}
	}
	return { counts, lines };
}

describe("money arithmetic ratchet", () => {
	it("counts by type what each rule names, and nothing else", () => {
		// arithmetic.fixture.ts marks each line with what it must count.
		const hits = hitsIn(
			join(REPO_ROOT, "src/test/money/arithmetic.fixture.ts"),
		);
		expect(hits["prisma-decimal"]).toEqual([7, 8, 8]);
		expect(hits.float.sort((a, b) => a - b)).toEqual([10, 11, 12, 13]);
	});

	it("stays at the baseline", () => {
		const { counts, lines } = scan();
		const base = baseline as Counts;
		const problems: string[] = [];
		for (const rule of ["float", "prisma-decimal"] as const) {
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
	}, 60_000);
});
