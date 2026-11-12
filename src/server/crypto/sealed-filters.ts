/**
 * Whether a model call filters, sorts, groups or aggregates on a mapped
 * column (E2EE D11 PR 4.3, docs/roadmap/e2ee-d11-pr4.md section 3). Once the
 * field encryption epoch exists any mapped cell may hold ciphertext with a
 * random nonce, so Postgres would compare, sort or group the ciphertext and
 * quietly miss rows; field-open.ts refuses such a call instead.
 *
 * The scan is synchronous over the arguments and reads no data. It looks at
 * every argument that Prisma turns into SQL over column values: `where`,
 * `cursor`, `having`, `orderBy`, `distinct`, `groupBy.by`, `_min` and `_max`,
 * at the top and in every nested read (`select`, `include`, `_count`) and
 * nested write (the `where` of `connect`, `set`, `updateMany` and the rest).
 * Inside a filter it descends every nested object, not only relations, so a
 * compound unique key such as `{ name_userId: { name, userId } }` is caught
 * as well. A null test is refused too: it never needs to, but no caller makes
 * one (userTextModelQueries.test.ts) and one rule is simpler.
 */
import { cellClassesOfModel, jsonCellsOfModel } from "./fields";
import { jsonFilterAllowed } from "./json-cells";
import type { ModelGraph } from "./model-graph";

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isMapped = (model: string, field: string) =>
	Object.hasOwn(cellClassesOfModel(model), field);

/** A JSON path filter on a leaves cell that reads no sealed leaf (json-cells.ts). */
function allowedJsonFilter(model: string, field: string, filter: unknown) {
	const cell = jsonCellsOfModel(model)?.columns[field];
	return cell !== undefined && jsonFilterAllowed(cell, filter);
}

/** Arguments whose keys are columns of the model, at any depth. */
const FILTERS = ["where", "cursor", "having", "orderBy", "_min", "_max"];
/** Arguments that list column names as strings. */
const NAME_LISTS = ["distinct", "by"];
/** Arguments that hold nested reads or writes of the same model. */
const NESTED = ["select", "include", "data", "create", "update"];
/** Nested write operations whose value is itself a unique filter. */
const UNIQUE_OPS = new Set([
	"connect",
	"disconnect",
	"set",
	"delete",
	"deleteMany",
]);

/**
 * A filter (or sort, or aggregate pick) that names a mapped column of
 * `model`. Relation keys move to the related model; any other nested object
 * (`AND`, `some`, `is`, a compound unique key, `_count`) stays on this one.
 */
function filterNames(graph: ModelGraph, model: string, node: unknown): boolean {
	if (Array.isArray(node))
		return node.some((item) => filterNames(graph, model, item));
	if (!isRow(node)) return false;
	const relations = graph.relations(model);
	for (const [key, value] of Object.entries(node)) {
		if (value === undefined) continue;
		if (isMapped(model, key)) {
			if (allowedJsonFilter(model, key, value)) continue;
			return true;
		}
		if (filterNames(graph, relations.get(key) ?? model, value)) return true;
	}
	return false;
}

/**
 * Whether the arguments of a model call (or of a nested read or write) on
 * `model` filter, sort or group on a mapped column.
 */
export function filtersOnSealed(
	graph: ModelGraph,
	model: string,
	args: unknown,
): boolean {
	if (Array.isArray(args))
		return args.some((item) => filtersOnSealed(graph, model, item));
	if (!isRow(args)) return false;
	if (FILTERS.some((key) => filterNames(graph, model, args[key]))) return true;
	const named = (list: unknown) =>
		[list]
			.flat()
			.some((name) => typeof name === "string" && isMapped(model, name));
	if (NAME_LISTS.some((key) => named(args[key]))) return true;
	return NESTED.some((key) => nestedName(graph, model, args[key]));
}

/**
 * A selection or a data object: its relation fields hold nested read
 * arguments or nested write operations on the related model. A scalar field
 * is never looked into, so a JSON value cannot look like an argument.
 */
function nestedName(graph: ModelGraph, model: string, node: unknown): boolean {
	if (Array.isArray(node))
		return node.some((item) => nestedName(graph, model, item));
	if (!isRow(node)) return false;
	for (const [field, target] of graph.relations(model)) {
		const value = node[field];
		if (!isRow(value)) continue;
		if (filtersOnSealed(graph, target, value)) return true;
		// Nested writes: { connect: {...}, updateMany: { where, data }, ... }.
		for (const [op, operand] of Object.entries(value))
			if (
				UNIQUE_OPS.has(op)
					? filterNames(graph, target, operand)
					: filtersOnSealed(graph, target, operand) ||
						nestedName(graph, target, operand)
			)
				return true;
	}
	return isRow(node._count) && nestedName(graph, model, node._count.select);
}
