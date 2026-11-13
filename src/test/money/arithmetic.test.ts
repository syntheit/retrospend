// Money arithmetic ratchet (docs/roadmap/money-decimal.md, D5). Money math is
// exact Decimal (`@retrospend/domain/money-dec`); a float or Prisma's Decimal
// (20 digits, half up) in a figure loses cents. Two counts per file of money
// code, compared with arithmetic-baseline.json:
//
// - float: a money value leaving Decimal for a float. `Number(` whose
//   argument names a money value (amount, balance, total, ...InUSD) or whose
//   type is a Decimal or a stand-in for one (decimal.js, Prisma's Decimal,
//   `PrismaDecimal`, `DecimalInput`, `{ toString(): string }`), any
//   `.toNumber()` or `parseFloat(`, unary `+` on those types, a call to a
//   `toNumber`, `toNumberWithDefault` or `toNumberOrNull` helper, and an edge
//   helper (`toFloat`, `roundedMajor`) anywhere but as an object literal
//   property value or a return value: in arithmetic, a reduce or a variable
//   it is a figure computed in floats. A hit that is not money (a count, a
//   percentage) goes in NOT_MONEY below with its reason; a match is never
//   narrowed to drop one.
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
	type CallExpression,
	type Node,
	type PrefixUnaryExpression,
	type PropertyAccessExpression,
	SyntaxKind,
} from "typescript/unstable/ast";
import {
	isArrowFunction,
	isAsExpression,
	isCallExpression,
	isConditionalExpression,
	isIdentifier,
	isNonNullExpression,
	isParenthesizedExpression,
	isPrefixUnaryExpression,
	isPropertyAccessExpression,
	isPropertyAssignment,
	isReturnStatement,
	isSatisfiesExpression,
} from "typescript/unstable/ast/is";
import { API, type Checker, type Type } from "typescript/unstable/sync";
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
/** decimal.ts: PrismaDecimal, the structural stand-in for Prisma's Decimal. */
const DECIMAL_TS = /packages\/domain\/src\/decimal\.ts$/;
/** Helpers that turn a Decimal or a stand-in into a float, wherever they are declared. */
const NUMBER_HELPERS = new Set([
	"toNumber",
	"toNumberWithDefault",
	"toNumberOrNull",
]);
/** The edges: a Decimal becomes a number only here (precise-decimal.ts, money-minor.ts). */
const EDGE_HELPERS = new Set(["toFloat", "roundedMajor"]);

/** A hit that is not money, kept out of the count with its reason. An entry that matches nothing fails. */
interface NotMoney {
	readonly file: string;
	/** Text the hit's source line contains. */
	readonly includes: string;
	readonly reason: string;
}
const NOT_MONEY: readonly NotMoney[] = [
	{
		file: "packages/domain/src/envelope/units.ts",
		includes: "scaled.toNumber()",
		reason:
			"A rounded whole number of minor units, checked safe by assertMinor on the same line",
	},
	{
		file: "packages/domain/src/envelope/units.ts",
		includes: "Number(total)",
		reason:
			"A BigInt sum of whole minor units, checked safe by assertMinor on the same line",
	},
	{
		file: "packages/domain/src/insights.ts",
		includes: "Number(divideHalfEven(",
		reason:
			"A whole-number average of minor units from exact BigInt division, never a fraction",
	},
];

/**
 * Whether an edge helper call is an object literal property value or a return
 * value, through a conditional, parentheses or a cast, or the amount handed
 * to formatCurrency (text for a person, never computed on). A variable, an
 * operand, any other argument or a reduce is not.
 */
function atEdge(call: CallExpression): boolean {
	let node: Node = call;
	for (;;) {
		const parent = node.parent;
		if (
			isParenthesizedExpression(parent) ||
			isAsExpression(parent) ||
			isSatisfiesExpression(parent) ||
			isNonNullExpression(parent) ||
			(isConditionalExpression(parent) && parent.condition !== node)
		) {
			node = parent;
			continue;
		}
		return (
			(isPropertyAssignment(parent) && parent.initializer === node) ||
			isReturnStatement(parent) ||
			(isArrowFunction(parent) && parent.body === node) ||
			(isCallExpression(parent) &&
				isIdentifier(parent.expression) &&
				parent.expression.text === "formatCurrency" &&
				parent.arguments[0] === node)
		);
	}
}

/**
 * A Decimal or a stand-in for one: decimal.js or Prisma's class,
 * `PrismaDecimal`, `DecimalInput`, or any `{ toString(): string }` literal
 * type. A union counts when any member does.
 */
function decimalLike(type: Type | undefined, checker: Checker): boolean {
	if (!type) return false;
	if (type.isUnionType())
		return type.getTypes().some((t) => decimalLike(t, checker));
	if (declaredIn(type, ANY_DECIMAL) || declaredIn(type, DECIMAL_TS))
		return true;
	if (type.getAliasSymbol()?.name === "DecimalInput") return true;
	const properties = type.isObjectType()
		? checker.getPropertiesOfType(type)
		: [];
	return (
		type.getSymbol()?.name === "__type" &&
		properties.length === 1 &&
		properties[0]?.name === "toString"
	);
}

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
	const named = [...code.matchAll(FLOAT_TEXT)];
	const float = named.map((m) => lineAt(code, m.index));
	const namedAt = new Set(named.map((m) => m.index));
	const calls: PropertyAccessExpression[] = [];
	const pluses: PrefixUnaryExpression[] = [];
	const numbers: CallExpression[] = [];
	const helpers: CallExpression[] = [];
	const edges: CallExpression[] = [];
	const visit = (node: Node): void => {
		if (isCallExpression(node)) {
			if (
				isPropertyAccessExpression(node.expression) &&
				METHODS.has(node.expression.name.text)
			)
				calls.push(node.expression);
			if (
				isIdentifier(node.expression) &&
				node.expression.text === "Number" &&
				node.arguments.length === 1
			)
				numbers.push(node);
			if (
				isIdentifier(node.expression) &&
				NUMBER_HELPERS.has(node.expression.text)
			)
				helpers.push(node);
			if (
				isIdentifier(node.expression) &&
				EDGE_HELPERS.has(node.expression.text)
			)
				edges.push(node);
		}
		if (isPrefixUnaryExpression(node) && node.operator === SyntaxKind.PlusToken)
			pluses.push(node);
		node.forEachChild(visit);
	};
	visit(file);
	const { checker } = project;
	const types = checker.getTypeAtLocation([
		...calls.map((c) => c.expression),
		...pluses.map((p) => p.operand),
		...numbers.map((n) => n.arguments[0] as Node),
	]);
	const prisma = calls
		.filter((_, i) => declaredIn(types[i], PRISMA_DECIMAL))
		.map((c) => lineAt(file.text, c.end));
	pluses.forEach((p, i) => {
		if (decimalLike(types[calls.length + i], checker))
			float.push(lineAt(file.text, p.pos + 1));
	});
	numbers.forEach((n, i) => {
		// `Number(` is 7 characters before its argument's parenthesis.
		const start = n.expression.end - "Number".length;
		if (
			!namedAt.has(start) &&
			decimalLike(types[calls.length + pluses.length + i], checker)
		)
			float.push(lineAt(file.text, start));
	});
	for (const call of helpers) float.push(lineAt(file.text, call.expression.end));
	for (const call of edges)
		if (!atEdge(call)) float.push(lineAt(file.text, call.expression.end));
	return { float, "prisma-decimal": prisma };
}

/** `float` hits that no entry of `list` excuses, and the entries that excused nothing. */
function withoutNotMoney(
	file: string,
	path: string,
	lines: number[],
	list: readonly NotMoney[],
	used: Set<NotMoney>,
): number[] {
	const text = project.program.getSourceFile(path)?.text.split("\n") ?? [];
	return lines.filter((n) => {
		const entry = list.find(
			(e) => e.file === file && (text[n - 1] ?? "").includes(e.includes),
		);
		if (entry) used.add(entry);
		return !entry;
	});
}

function scan(): {
	counts: Counts;
	lines: Record<string, string[]>;
	unused: NotMoney[];
} {
	const used = new Set<NotMoney>();
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
		for (const [rule, found] of Object.entries(hitsIn(path)) as [
			Rule,
			number[],
		][]) {
			const at =
				rule === "float"
					? withoutNotMoney(file, path, found, NOT_MONEY, used)
					: found;
			if (at.length === 0) continue;
			counts[rule] = { ...counts[rule], [file]: at.length };
			lines[`${rule} ${file}`] = at
				.sort((a, b) => a - b)
				.map((n) => `${file}:${n}`);
		}
	}
	return { counts, lines, unused: NOT_MONEY.filter((e) => !used.has(e)) };
}

describe("money arithmetic ratchet", () => {
	it("counts by type what each rule names, and nothing else", () => {
		// arithmetic.fixture.ts marks each line with what it must count.
		const hits = hitsIn(
			join(REPO_ROOT, "src/test/money/arithmetic.fixture.ts"),
		);
		expect(hits["prisma-decimal"]).toEqual([19, 20, 20]);
		expect(hits.float.sort((a, b) => a - b)).toEqual([
			// fixture(): unary plus, toNumber(), parseFloat, a money name
			22, 23, 24, 25,
			// standIns(): the stand-in types, then the three helpers by name
			41, 42, 43, 44, 45, 46, 47, 48, 49,
			// edges(): a variable (x2), arithmetic, a reduce, an argument (x2)
			62, 63, 64, 65, 66, 68,
			// paged(): a money name, until the list excuses it
			74,
		]);
	});

	it("excuses a hit that is not money only through a named entry, and reports an unused one", () => {
		const path = join(REPO_ROOT, "src/test/money/arithmetic.fixture.ts");
		const file = "src/test/money/arithmetic.fixture.ts";
		const hits = hitsIn(path).float.sort((a, b) => a - b);
		const page: NotMoney = {
			file,
			includes: "Number(page.total)",
			reason: "A page count named total, not an amount",
		};
		const stale: NotMoney = {
			file,
			includes: "Number(nothing here)",
			reason: "x",
		};
		const used = new Set<NotMoney>();
		const left = withoutNotMoney(file, path, hits, [page, stale], used);
		expect(left).toEqual(hits.filter((n) => n !== 74));
		expect([...used]).toEqual([page]);
		// Another file's entry excuses nothing.
		const other = { ...page, file: "x.ts" };
		expect(withoutNotMoney(file, path, hits, [other], new Set())).toEqual(hits);
	});

	it("stays at the baseline", () => {
		const { counts, lines, unused } = scan();
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
		for (const e of unused)
			problems.push(
				`not-money entry matches nothing, remove it: ${e.file} "${e.includes}"`,
			);
		expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
	}, 60_000);
});
