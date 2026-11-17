/**
 * The write walk. `planWrite` reads a model call's arguments, through every
 * nested write, and is the one place that inspects what a write stores:
 * - It refuses a value that already looks sealed, at any depth, in every
 *   mode (sealing on or off, a create, an update, an `updateMany`). Only
 *   `verbatim` mode (db-tx.ts) lets a top-level one through, returned in
 *   `kept` for field-open.ts to open under the AAD of the cell it is
 *   written to; a nested one is refused even there.
 * - In `seal` mode it also returns a copy in which every mapped column the
 *   write sets is queued to be sealed under the AAD of the row it lands in;
 *   `applySeal` seals the queued cells once the keys are known (field-open.ts
 *   picks them). The caller's objects are never changed.
 * The seal-only rules below run in `seal` mode only.
 *
 * A cell's AAD names its row, so:
 * - A create that seals text and names no id gets one before the insert
 *   (row-id.ts). An upsert's create half takes its own id, else the where's
 *   (written into the data, so the row inserted is the row named).
 * - An update binds to `where.id`. With no id the cell has no row to name and
 *   the write is refused; so is a bulk write (`updateMany`) that sets text,
 *   since each row needs its own AAD. A null seals nothing and passes.
 * - User-class text is sealed with the client's user's key only. A create
 *   names its owner (the model's owner column, `userId` by default, or the
 *   owner relation's `connect.id`, `user` by default), which must be that
 *   user. An update cannot name it: RLS keeps a scoped client to its own
 *   rows, and the global client holds no user key, so it is refused there.
 *
 * Plain strings and `{ set }` are text; "" is sealed like any text. Nothing is
 * sealed in `verbatim`, so nothing is sealed twice. A JSON cell (PR 8.1) is
 * sealed by the same rules, piece by piece (json-cells.ts).
 */
import {
	FieldCryptoError,
	isSealedField,
	type Keyring,
	sealField,
} from "./field-crypto";
import {
	fieldsOfModel,
	jsonCellsOfModel,
	type KeyClass,
	ownerOfModel,
} from "./fields";
import { plainPieces, sealedPieces } from "./json-cells";
import type { ModelGraph } from "./model-graph";
import { idOf, isRow, newRowId, type Row } from "./row-id";

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

/**
 * How a write is walked. `seal`: sealing is on, the write is sealed.
 * `plain`: sealing is off, the write is stored as given. `verbatim`: inside
 * db-tx.ts `verbatim`, stored as given, and a top-level sealed value is kept
 * for the caller to open instead of refused.
 */
export type WriteMode = "seal" | "plain" | "verbatim";

/** A sealed-looking value a top-level write stores, in `verbatim` mode only. */
export interface KeptSealed {
	table: string;
	/** The AAD column: a JSON piece's own. */
	column: string;
	cls: KeyClass;
	sealed: string;
	/** The row field of a JSON piece. */
	json?: { field: string };
	/** The row the data is stored in, when the arguments name it. */
	rowId: string | undefined;
	creates: boolean;
	data: Row;
}

interface Walk {
	graph: ModelGraph;
	/** The client's user; undefined on the global client. */
	userId: string | undefined;
	mode: WriteMode;
	cells: SealCell[];
	kept: KeptSealed[];
	/** 0 for the call's own data, more inside a nested write. */
	depth: number;
}

/** Where a data object is stored. */
interface Place {
	rowId: string | undefined;
	creates: boolean;
}

/** A sealed-looking value is refused, except one a verbatim write names at the top. */
function refuseSealed(w: Walk, kept: KeptSealed): void {
	if (w.mode !== "verbatim" || w.depth > 0)
		throw new FieldCryptoError("bad_plaintext");
	w.kept.push(kept);
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
 * Refuses (or keeps, see `refuseSealed`) each sealed-looking value `data`
 * sets, in any mode. Then, in `seal` mode only, returns the mapped columns of
 * `model` that `data` sets to text and the pieces of the JSON cells it sets.
 * `data` must be the walk's own copy.
 */
function textsOf(w: Walk, model: string, data: Row, at: Place): Text[] {
	const fields = fieldsOfModel(model);
	const json = jsonCellsOfModel(model);
	const texts: Text[] = [];
	if (fields)
		for (const [column, cls] of Object.entries(fields.columns)) {
			const found = textOf(data[column]);
			if (!found) continue;
			if (isSealedField(found.text))
				refuseSealed(w, {
					...at,
					data,
					table: fields.table,
					column,
					cls,
					sealed: found.text,
				});
			else texts.push({ ...found, column, cls, table: fields.table });
		}
	if (json)
		for (const [field, cell] of Object.entries(json.columns)) {
			for (const piece of sealedPieces(data, field, cell))
				refuseSealed(w, {
					...at,
					data,
					table: json.table,
					column: piece.column,
					cls: cell.cls,
					sealed: piece.sealed,
					json: { field },
				});
			if (w.mode === "seal")
				for (const piece of plainPieces(data, field, cell))
					texts.push({
						...piece,
						wrapped: false,
						cls: cell.cls,
						table: json.table,
					});
		}
	return w.mode === "seal" ? texts : [];
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

const ownerOf = (model: string, data: Row): string | undefined => {
	const { column, relation } = ownerOfModel(model);
	const value = data[column];
	if (typeof value === "string") return value;
	const link = data[relation];
	return idOf(isRow(link) ? link.connect : undefined);
};

function create(w: Walk, model: string, data: unknown, whereId?: string) {
	if (!isRow(data)) return data;
	const next = { ...data };
	const texts = textsOf(w, model, next, { rowId: idOf(next), creates: true });
	if (texts.length > 0) {
		if (
			texts.some((t) => t.cls === "user") &&
			(w.userId === undefined || ownerOf(model, next) !== w.userId)
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
	const texts = textsOf(w, model, next, { rowId, creates: false });
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

function refuseBulkText(w: Walk, model: string, data: unknown): void {
	for (const item of [data].flat())
		if (
			isRow(item) &&
			textsOf(w, model, { ...item }, { rowId: undefined, creates: false })
				.length > 0
		)
			throw new FieldCryptoError("bulk_text_write");
}

/** Keys of a `{ where, data }` wrapper; a to-one nested update may also give the data bare. */
const isWrapped = (value: Row) =>
	isRow(value.data) &&
	Object.keys(value).every((k) => k === "where" || k === "data");

/** The nested writes in `data`, through each relation to a model that can hold text. */
function nested(w: Walk, model: string, data: Row): void {
	w.depth++;
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
				map(value, (u) => refuseBulkText(w, target, isRow(u) ? u.data : u));
		}
		data[field] = next;
	}
	w.depth--;
}

/**
 * Walks a model call's write arguments (see the top of the file). Throws
 * `FieldCryptoError` for a sealed-looking value, and in `seal` mode for a
 * write it cannot seal. In `seal` mode `args` is a copy with ids assigned and
 * `cells` lists what to seal; otherwise `args` is the caller's own and
 * `cells` is empty. `kept` is `verbatim` mode's top-level sealed values.
 */
export function planWrite(
	graph: ModelGraph,
	userId: string | undefined,
	model: string,
	operation: string,
	args: Row,
	mode: WriteMode,
): { args: Row; cells: SealCell[]; kept: KeptSealed[] } {
	const w: Walk = { graph, userId, mode, cells: [], kept: [], depth: 0 };
	if (!graph.reaches(model)) return { args, cells: [], kept: [] };
	const next = { ...args };
	if (operation === "create") next.data = create(w, model, args.data);
	else if (operation === "createMany" || operation === "createManyAndReturn")
		next.data = map(args.data, (d) => create(w, model, d));
	else if (operation === "update")
		next.data = update(w, model, args.data, idOf(args.where), false);
	else if (operation === "upsert")
		Object.assign(next, upsert(w, model, args, false));
	else if (operation === "updateMany" || operation === "updateManyAndReturn")
		refuseBulkText(w, model, args.data);
	return {
		args: mode === "seal" ? next : args,
		cells: w.cells,
		kept: w.kept,
	};
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
