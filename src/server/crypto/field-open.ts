/**
 * The field-open extension (E2EE D11 PR 3.2, docs/roadmap/e2ee-d11-pr3.md
 * sections 2 to 4): it sits in the client slot (db-core.ts) and opens every
 * sealed cell a model call returns, at any depth of `select` or `include`.
 * Plaintext passes untouched; nothing seals here (that is PR 4).
 *
 * Who may open a sealed cell:
 * - An instance-class cell, or a user-class cell whose `userId` is the
 *   client's user: opened with that ring. A ring that lacks the key (or no
 *   ring) gets one reload; still nothing fails the request with the recorded
 *   code (`keystore_lost` when the key row is simply absent). There is no
 *   fallback: the reader is entitled to the text, so hiding it would hide a
 *   lost keystore.
 * - A user-class cell of another owner, or any user-class cell on the global
 *   client: never tried (key ids are small integers, so a stranger's key 1
 *   would fail the tag and look like corruption). It reads as "" and the row
 *   carries the field name under `UNAVAILABLE_FIELDS`, which never
 *   serializes. `userText()` minimums refuse "" on required columns, so a
 *   fallback cannot be written back as a real value.
 * - `auth_failed`, `malformed`, `unsupported_version`: the request fails.
 *   Integrity is never hidden. Failures and fallbacks log table, column and
 *   code only: never a row id, a user id or text.
 *
 * A cell's AAD needs its row id, and a user-class cell its owner, so a
 * `select` that names a mapped field without them gets `id` (and `userId`)
 * added, and they are removed from the result again.
 */
import type { ClientSlot } from "~/server/db-core";
import { FieldCryptoError, isSealedField, openField } from "./field-crypto";
import { fieldsOfModel, type KeyClass } from "./fields";
import type { ModelGraph } from "./model-graph";
import { hasSealedText } from "./response-guard";
import type { TextKeys } from "./text-keys";

/** On a row: the fields that read "" because the reader holds no key for them. */
export const UNAVAILABLE_FIELDS = Symbol("encrypted_text_unavailable");

/** The fields of a row that hold the fallback, not the text. */
export function unavailableFields(row: object): readonly string[] {
	return (row as { [UNAVAILABLE_FIELDS]?: string[] })[UNAVAILABLE_FIELDS] ?? [];
}

/** The key a sealed cell needs is not available to a reader entitled to it. */
export class TextUnavailableError extends Error {
	readonly code: string;
	constructor(code: string) {
		super("Encrypted text cannot be opened because its key is unavailable");
		this.name = "TextUnavailableError";
		this.code = code;
	}
}

/**
 * Whether an unavailable key is behind `error`, at any depth of `cause`: a
 * figure, tRPC or a service may wrap it, and the stable API code must still
 * reach the caller.
 */
export function isTextUnavailable(error: unknown): boolean {
	for (let e = error, depth = 0; e && depth < 8; depth++) {
		if (e instanceof TextUnavailableError) return true;
		e = (e as { cause?: unknown }).cause;
	}
	return false;
}

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** What the walk added to a `select` (or took out of an `omit`), per level. */
interface Added {
	fields: string[];
	children: Map<string, Added>;
}

/** `id` for the AAD, and `userId` when a user-class cell is among `named`. */
function needed(model: string, named: string[]): string[] {
	const columns = fieldsOfModel(model)?.columns ?? {};
	return named.some((f) => columns[f] === "user") ? ["id", "userId"] : ["id"];
}

/**
 * A copy of the arguments with `id` and `userId` added wherever a mapped
 * field is read without them, and the record of what was added. The caller's
 * objects are never changed.
 */
function prepare(
	graph: ModelGraph,
	model: string,
	node: Row,
): { node: Row; added?: Added } {
	const mapped = Object.keys(fieldsOfModel(model)?.columns ?? {});
	const added: Added = { fields: [], children: new Map() };
	const next = { ...node };
	if (isRow(node.select)) {
		const select = { ...node.select };
		const named = mapped.filter((f) => select[f] === true);
		if (named.length > 0)
			for (const f of needed(model, named))
				if (select[f] !== true) {
					select[f] = true;
					added.fields.push(f);
				}
		descend(graph, model, select, added);
		next.select = select;
	} else {
		if (isRow(node.omit)) {
			const omit = { ...node.omit };
			const kept = mapped.filter((f) => omit[f] !== true);
			if (kept.length > 0)
				for (const f of needed(model, kept))
					if (omit[f] === true) {
						delete omit[f];
						added.fields.push(f);
					}
			next.omit = omit;
		}
		if (isRow(node.include)) {
			const include = { ...node.include };
			descend(graph, model, include, added);
			next.include = include;
		}
	}
	return added.fields.length > 0 || added.children.size > 0
		? { node: next, added }
		: { node };
}

function descend(
	graph: ModelGraph,
	model: string,
	selection: Row,
	added: Added,
): void {
	for (const [field, target] of graph.relations(model)) {
		const value = selection[field];
		if (!isRow(value) || !graph.reaches(target)) continue;
		const child = prepare(graph, target, value);
		if (!child.added) continue;
		selection[field] = child.node;
		added.children.set(field, child.added);
	}
}

function strip(value: unknown, added: Added): void {
	if (Array.isArray(value)) {
		for (const item of value) strip(item, added);
		return;
	}
	if (!isRow(value)) return;
	for (const field of added.fields) delete value[field];
	for (const [field, child] of added.children) strip(value[field], child);
}

interface Cell {
	row: Row;
	table: string;
	column: string;
	cls: KeyClass;
	sealed: string;
}

/** Every sealed cell in a result, through every relation the graph names. */
function collect(
	graph: ModelGraph,
	model: string,
	value: unknown,
	cells: Cell[],
): void {
	if (Array.isArray(value)) {
		for (const item of value) collect(graph, model, item, cells);
		return;
	}
	if (!isRow(value) || !graph.reaches(model)) return;
	const fields = fieldsOfModel(model);
	if (fields)
		for (const [column, cls] of Object.entries(fields.columns)) {
			const cell = value[column];
			if (typeof cell === "string" && isSealedField(cell))
				cells.push({
					row: value,
					table: fields.table,
					column,
					cls,
					sealed: cell,
				});
		}
	for (const [field, target] of graph.relations(model))
		if (field in value) collect(graph, target, value[field], cells);
}

function hide(cell: Cell): void {
	cell.row[cell.column] = "";
	const row = cell.row as { [UNAVAILABLE_FIELDS]?: string[] };
	const list = row[UNAVAILABLE_FIELDS];
	if (list) list.push(cell.column);
	else
		Object.defineProperty(row, UNAVAILABLE_FIELDS, {
			value: [cell.column],
			enumerable: false,
		});
}

const logFailure = (cell: Cell, code: string) =>
	console.error("Sealed text could not be opened", {
		table: cell.table,
		column: cell.column,
		code,
	});

/** Opens the cell in place. False when there is no ring or it lacks the key; anything else throws. */
function tryOpen(keys: TextKeys, cell: Cell): boolean {
	const ring = keys.ring(cell.cls);
	if (!ring) return false;
	try {
		cell.row[cell.column] = openField(ring, cell.sealed, {
			table: cell.table,
			column: cell.column,
			rowId: cell.row.id as string,
		});
		return true;
	} catch (error) {
		if (error instanceof FieldCryptoError && error.code === "unknown_key")
			return false;
		logFailure(cell, error instanceof FieldCryptoError ? error.code : "error");
		throw error;
	}
}

function fail(keys: TextKeys, cell: Cell): never {
	const outcome = keys.outcome(cell.cls);
	const code =
		outcome && "failed" in outcome
			? outcome.failed
			: (outcome && "none" in outcome && outcome.code) || "keystore_lost";
	logFailure(cell, code);
	throw new TextUnavailableError(code);
}

async function openCells(keys: TextKeys, cells: Cell[]): Promise<void> {
	const entitled: Cell[] = [];
	const hidden = new Set<string>();
	for (const cell of cells) {
		if (cell.cls === "instance") {
			entitled.push(cell);
			continue;
		}
		const owner = cell.row.userId;
		if (typeof owner !== "string")
			throw new Error(
				`A ${cell.table}.${cell.column} cell was read without its owner`,
			);
		if (owner === keys.userId) entitled.push(cell);
		else {
			hide(cell);
			hidden.add(`${cell.table}.${cell.column}`);
		}
	}
	// One line per column per call, not per row: a list of shared expenses
	// would otherwise log every co-participant's category.
	for (const cell of hidden) {
		const [table, column] = cell.split(".");
		console.warn("encrypted_text_unavailable", { table, column });
	}
	if (entitled.length === 0) return;
	// A model call outside a transaction did not wait for the keys. Every
	// caller shares the loaders' cached load, so this is not throttled.
	if (entitled.some((cell) => keys.outcome(cell.cls) === undefined))
		await keys.ready();
	const retry = entitled.filter((cell) => !tryOpen(keys, cell));
	if (retry.length === 0) return;
	for (const cls of new Set(retry.map((cell) => cell.cls)))
		await keys.reload(cls);
	for (const cell of retry) if (!tryOpen(keys, cell)) fail(keys, cell);
}

const WRITES_DATA = new Set([
	"create",
	"update",
	"createMany",
	"createManyAndReturn",
	"updateMany",
	"updateManyAndReturn",
]);

/**
 * A ciphertext written as if it were text is refused before it runs: a
 * copied sealed value would be stored under the wrong cell, and sealed twice
 * once PR 4 seals. Top-level writes only; nested writes are PR 4's. An
 * `updateMany` that sets a mapped column to plaintext still runs: two callers
 * do, and PR 4 must move them to per-row writes before it refuses that shape
 * (each row needs its own AAD and nonce): export_job.fileName in
 * services/api-v1/export-run.ts:124, and split_participant.rejectionReason
 * (set to null) in services/shared-expenses/transaction.service.ts:647.
 */
function refuseWrites(model: string, operation: string, args: Row): void {
	const columns = Object.keys(fieldsOfModel(model)?.columns ?? {});
	if (columns.length === 0) return;
	const data =
		operation === "upsert"
			? [args.create, args.update]
			: WRITES_DATA.has(operation)
				? [args.data].flat()
				: [];
	for (const values of data) {
		if (!isRow(values)) continue;
		for (const f of columns) {
			const value = values[f];
			const text = isRow(value) ? value.set : value;
			if (typeof text === "string" && isSealedField(text))
				throw new FieldCryptoError("bad_plaintext");
		}
	}
}

const WALKED = new Set([
	"findUnique",
	"findUniqueOrThrow",
	"findFirst",
	"findFirstOrThrow",
	"findMany",
	"create",
	"createManyAndReturn",
	"update",
	"updateManyAndReturn",
	"upsert",
	"delete",
]);

/**
 * The slot for db.ts. `graph` is read on the first query. `count`,
 * `createMany`, `updateMany` and `deleteMany` return no text; `aggregate` and
 * `groupBy` cannot be opened (no row id), so a sealed value in one fails.
 */
export function fieldOpenSlot(graph: () => ModelGraph): ClientSlot {
	return (client, keys) =>
		client.$extends({
			name: "field-open",
			query: {
				$allModels: {
					async $allOperations({ model, operation, args, query }) {
						const given = (args ?? {}) as Row;
						refuseWrites(model, operation, given);
						if (operation === "aggregate" || operation === "groupBy") {
							const result = await query(args);
							if (hasSealedText(result))
								throw new Error(
									`${model}.${operation} returned encrypted text it cannot open`,
								);
							return result;
						}
						const models = graph();
						if (!WALKED.has(operation) || !models.reaches(model))
							return query(args);
						const { node, added } = prepare(models, model, given);
						const result = await query(node as typeof args);
						const cells: Cell[] = [];
						collect(models, model, result, cells);
						await openCells(keys, cells);
						if (added) strip(result, added);
						return result;
					},
				},
			},
		}) as unknown as typeof client;
}
