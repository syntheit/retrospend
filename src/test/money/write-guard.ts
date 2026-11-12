/**
 * Test-only guard: a JS number written to a Decimal column (every money and
 * rate column is one) is refused, because a float has already lost the exact
 * value by the time it reaches Prisma. Writers pass a string from money-dec
 * (docs/roadmap/money-decimal.md, D5).
 *
 * pg-env.ts puts it on the client every pg test runs through. The writers
 * that still wrote numbers when the guard landed are listed in
 * number-writes.json, by column and file; each comes off the list when it
 * moves to Decimal, and the list only shrinks.
 */
import { relative } from "node:path";
import type { RuntimeModels } from "~/server/crypto/model-graph";
import { REPO_ROOT } from "../uiRules/paths";
import allowed from "./number-writes.json";

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const WRITES = new Set([
	"create",
	"createMany",
	"createManyAndReturn",
	"update",
	"updateMany",
	"updateManyAndReturn",
	"upsert",
]);

/** Argument keys that hold data to write, at the top or in a nested relation write. */
const WRITE_KEYS = new Set([
	"data",
	"create",
	"update",
	"upsert",
	"createMany",
	"updateMany",
	"connectOrCreate",
]);

/** A value, or an operation on it (`{ set }`, `{ increment }`), that is a JS number. */
const holdsNumber = (value: unknown) =>
	typeof value === "number" ||
	(isRow(value) && Object.values(value).some((v) => typeof v === "number"));

/**
 * The `Model.column` of every Decimal column `args` writes a JS number to, at
 * any depth of nested relation writes. Filters (`where`) are not writes.
 */
export function numberWrites(
	data: RuntimeModels,
	model: string,
	args: unknown,
): string[] {
	const found = new Set<string>();
	const walk = (current: string, node: unknown): void => {
		if (Array.isArray(node)) {
			for (const item of node) walk(current, item);
			return;
		}
		if (!isRow(node)) return;
		const fields = data.models[current]?.fields ?? [];
		for (const [key, value] of Object.entries(node)) {
			const field = fields.find((f) => f.name === key);
			if (field?.kind === "object") walk(field.type, value);
			else if (field) {
				if (field.type === "Decimal" && holdsNumber(value))
					found.add(`${current}.${key}`);
			} else if (WRITE_KEYS.has(key)) walk(current, value);
		}
	};
	walk(model, args);
	return [...found].sort();
}

interface Extendable {
	$extends(extension: unknown): unknown;
}

/** Where a write was called from, as Prisma records it for its error messages. */
interface CallSite {
	getLocation(): { fileName: string; lineNumber: number | null } | null;
}

/** Test code: fixtures and harnesses write literal numbers on purpose. */
const TEST_CODE = /\.test\.tsx?$|\/__tests__\/|\/src\/test\//;

/** Files still allowed to write a number, by `Model.column`. */
export type NumberWriters = Readonly<Record<string, readonly string[]>>;

/**
 * `client` with every write checked. A write called from test code passes,
 * and so does one `allow` lists for its column and file. The call site is
 * Prisma's own record (an internal parameter); when it is missing the write
 * is refused, so an upgrade that moves it makes the guard stricter, never
 * looser. The data model is read at the first write, through db-core, which
 * may itself be built on this client (pg-env.ts), so it cannot be read
 * before.
 */
export function guardMoneyWrites<C extends Extendable>(
	client: C,
	allow: NumberWriters = allowed,
	isTestCode: (file: string) => boolean = (file) => TEST_CODE.test(file),
): C {
	return client.$extends({
		name: "money-write-guard",
		query: {
			$allModels: {
				async $allOperations(params: {
					model: string;
					operation: string;
					args: unknown;
					query: (args: unknown) => Promise<unknown>;
					__internalParams?: { callsite?: CallSite };
				}) {
					const { model, operation, args, query } = params;
					if (!WRITES.has(operation)) return query(args);
					const at = params.__internalParams?.callsite?.getLocation();
					if (at && isTestCode(at.fileName)) return query(args);
					const file =
						at && relative(REPO_ROOT, at.fileName).split("\\").join("/");
					const { runtimeDataModel } = await import("~/server/db-core");
					const bad = numberWrites(runtimeDataModel(), model, args).filter(
						(column) => !(file && allow[column]?.includes(file)),
					);
					if (bad.length > 0)
						throw new Error(
							`A JS number was written to ${bad.join(", ")} at ${at ? `${file}:${at.lineNumber}` : "an unknown call site"}: write a string from @retrospend/domain/money-dec (src/test/money/write-guard.ts)`,
						);
					return query(args);
				},
			},
		},
	}) as C;
}
