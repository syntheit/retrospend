/**
 * The seal path (E2EE D11 PR 4.2, docs/roadmap/e2ee-d11-pr4.md sections 1
 * and 2). `planSeal` reads a model call's arguments and returns a copy in
 * which every mapped column it writes, at any depth, is queued to be sealed
 * under the AAD of the row it lands in; `applySeal` seals the queued cells
 * once the keys are known (field-open.ts picks them). The caller's objects
 * are never changed. Both run only while `sealing()` is true.
 *
 * A cell's AAD names its row, so:
 * - A create that seals text and names no id gets one before the insert
 *   (row-id.ts). An upsert's create half takes its own id, else the where's
 *   (written into the data, so the row inserted is the row named).
 * - An update binds to `where.id`. With no id the cell has no row to name and
 *   the write is refused; so is a bulk write (`updateMany`) that sets text,
 *   since each row needs its own AAD. A null seals nothing and passes.
 * - User-class text is sealed with the client's user's key only. A create
 *   names its owner (`userId`, or `user.connect.id`), which must be that
 *   user. An update cannot name it: RLS keeps a scoped client to its own
 *   rows, and the global client holds no user key, so it is refused there.
 *
 * Plain strings and `{ set }` are text; "" is sealed like any text. A value
 * that already looks sealed is refused here: field-open.ts lets one through
 * only inside `verbatim`, and nothing is sealed there, so nothing is sealed
 * twice. A JSON cell (PR 8.1) is sealed by the same rules, piece by piece
 * (json-cells.ts).
 */
import {
	FieldCryptoError,
	isSealedField,
	type Keyring,
	sealField,
} from "./field-crypto";
import { fieldsOfModel, jsonCellsOfModel, type KeyClass } from "./fields";
import { plainPieces } from "./json-cells";
import type { ModelGraph } from "./model-graph";
import { newRowId } from "./row-id";

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const idOf = (value: unknown): string | undefined =>
	isRow(value) && typeof value.id === "string" ? value.id : undefined;

/** One cell to seal: `data[column]` of a copied data object. */
export interface SealCell {
	data: Row;
	model: string;
	table: string;
	column: string;
	cls: KeyClass;
	rowId: string;
	text: string;
	/** Written as `{ set: text }`. */
	wrapped: boolean;
	/** Stores the ciphertext of a JSON cell's piece; `column` is then its AAD column. */
	put?: (sealed: string) => void;
}

type Text = Omit<SealCell, "data" | "model" | "rowId">;

interface Walk {
	graph: ModelGraph;
	/** The client's user; undefined on the global client. */
	userId: string | undefined;
	cells: SealCell[];
}

const map = (value: unknown, each: (item: unknown) => unknown) =>
	Array.isArray(value) ? value.map(each) : each(value);

/** The text a write sets, if any: a string or `{ set: string }`. */
function textOf(
	value: unknown,
): { text: string; wrapped: boolean } | undefined {
	if (typeof value === "string") return { text: value, wrapped: false };
	if (isRow(value) && typeof value.set === "string")
		return { text: value.set, wrapped: true };
	return undefined;
}

/**
 * The mapped columns of `model` that `data` sets to text, and the pieces of
 * the JSON cells it sets. `data` must be the walk's own copy.
 */
function textsOf(model: string, data: Row): Text[] {
	const fields = fieldsOfModel(model);
	const texts: Text[] = fields
		? Object.entries(fields.columns).flatMap(([column, cls]) => {
				const found = textOf(data[column]);
				if (!found) return [];
				if (isSealedField(found.text))
					throw new FieldCryptoError("bad_plaintext");
				return [{ ...found, column, cls, table: fields.table }];
			})
		: [];
	const json = jsonCellsOfModel(model);
	if (json)
		for (const [column, cell] of Object.entries(json.columns))
			for (const piece of plainPieces(data, column, cell))
				texts.push({
					...piece,
					wrapped: false,
					cls: cell.cls,
					table: json.table,
				});
	return texts;
}

function queue(
	w: Walk,
	model: string,
	data: Row,
	rowId: string,
	texts: Text[],
): void {
	for (const t of texts) w.cells.push({ ...t, data, model, rowId });
}

const ownerOf = (data: Row): string | undefined =>
	typeof data.userId === "string"
		? data.userId
		: idOf(isRow(data.user) ? data.user.connect : undefined);

function create(w: Walk, model: string, data: unknown, whereId?: string) {
	if (!isRow(data)) return data;
	const next = { ...data };
	const texts = textsOf(model, next);
	if (texts.length > 0) {
		if (
			texts.some((t) => t.cls === "user") &&
			(w.userId === undefined || ownerOf(next) !== w.userId)
		)
			throw new FieldCryptoError("foreign_owner");
		if (typeof next.id !== "string") next.id = whereId ?? newRowId(model);
		queue(w, model, next, next.id as string, texts);
	}
	nested(w, model, next);
	return next;
}

function update(
	w: Walk,
	model: string,
	data: unknown,
	rowId: string | undefined,
	isNested: boolean,
) {
	if (!isRow(data)) return data;
	const next = { ...data };
	const texts = textsOf(model, next);
	if (texts.length > 0) {
		if (rowId === undefined)
			throw new FieldCryptoError(
				isNested ? "unsealable_nested" : "missing_row_id",
			);
		if (texts.some((t) => t.cls === "user") && w.userId === undefined)
			throw new FieldCryptoError("foreign_owner");
		queue(w, model, next, rowId, texts);
	}
	nested(w, model, next);
	return next;
}

function upsert(w: Walk, model: string, args: Row, isNested: boolean): Row {
	const whereId = idOf(args.where);
	return {
		...args,
		create: create(w, model, args.create, whereId),
		update: update(w, model, args.update, whereId, isNested),
	};
}

function refuseBulkText(model: string, data: unknown): void {
	for (const item of [data].flat())
		if (isRow(item) && textsOf(model, { ...item }).length > 0)
			throw new FieldCryptoError("bulk_text_write");
}

/** Keys of a `{ where, data }` wrapper; a to-one nested update may also give the data bare. */
const isWrapped = (value: Row) =>
	isRow(value.data) &&
	Object.keys(value).every((k) => k === "where" || k === "data");

/** The nested writes in `data`, through each relation to a model that can hold text. */
function nested(w: Walk, model: string, data: Row): void {
	for (const [field, target] of w.graph.relations(model)) {
		const ops = data[field];
		if (!isRow(ops) || !w.graph.reaches(target)) continue;
		const next = { ...ops };
		for (const op of Object.keys(next)) {
			const value = next[op];
			if (op === "create")
				next.create = map(value, (d) => create(w, target, d));
			else if (op === "createMany" && isRow(value))
				next.createMany = {
					...value,
					data: map(value.data, (d) => create(w, target, d)),
				};
			else if (op === "connectOrCreate")
				next.connectOrCreate = map(value, (c) =>
					isRow(c) ? { ...c, create: create(w, target, c.create) } : c,
				);
			else if (op === "upsert")
				next.upsert = map(value, (u) =>
					isRow(u) ? upsert(w, target, u, true) : u,
				);
			else if (op === "update")
				next.update = map(value, (u) =>
					isRow(u) && isWrapped(u)
						? { ...u, data: update(w, target, u.data, idOf(u.where), true) }
						: update(w, target, u, undefined, true),
				);
			else if (op === "updateMany")
				map(value, (u) => refuseBulkText(target, isRow(u) ? u.data : u));
		}
		data[field] = next;
	}
}

/**
 * A copy of `args` with ids assigned, and the cells to seal in it. Throws
 * `FieldCryptoError` for a write it cannot seal (see the top of the file).
 */
export function planSeal(
	graph: ModelGraph,
	userId: string | undefined,
	model: string,
	operation: string,
	args: Row,
): { args: Row; cells: SealCell[] } {
	const w: Walk = { graph, userId, cells: [] };
	if (!graph.reaches(model)) return { args, cells: [] };
	const next = { ...args };
	if (operation === "create") next.data = create(w, model, args.data);
	else if (operation === "createMany" || operation === "createManyAndReturn")
		next.data = map(args.data, (d) => create(w, model, d));
	else if (operation === "update")
		next.data = update(w, model, args.data, idOf(args.where), false);
	else if (operation === "upsert")
		return { args: upsert(w, model, args, false), cells: w.cells };
	else if (operation === "updateMany" || operation === "updateManyAndReturn")
		refuseBulkText(model, args.data);
	return { args: next, cells: w.cells };
}

/**
 * Seals each cell in its copied data with its class's ring. A class with no
 * ring stays plaintext: only a preview's rolled-back write gets here so
 * (field-open.ts). A category name is sealed only beside its name index: the
 * unique key on the plaintext name stops protecting once names are sealed.
 */
export function applySeal(
	cells: readonly SealCell[],
	ringOf: (cls: KeyClass) => Keyring | undefined,
): void {
	for (const cell of cells) {
		const ring = ringOf(cell.cls);
		if (!ring) continue;
		if (
			cell.model === "Category" &&
			cell.column === "name" &&
			!textOf(cell.data.nameIndex)
		)
			throw new FieldCryptoError("category_index_missing");
		const sealed = sealField(ring, cell.text, {
			table: cell.table,
			column: cell.column,
			rowId: cell.rowId,
		});
		if (cell.put) cell.put(sealed);
		else cell.data[cell.column] = cell.wrapped ? { set: sealed } : sealed;
	}
}
