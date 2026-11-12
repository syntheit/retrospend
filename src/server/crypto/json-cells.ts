/**
 * The pieces of a JSON cell that are sealed (E2EE D11 PR 8.1,
 * docs/roadmap/e2ee-d11-pr7-8.md, "Mechanism"). field-seal.ts and
 * field-open.ts seal and open each piece exactly as a text cell, with the
 * AAD `{ table, column, rowId }` of the row's own id:
 * - a `body` cell is one piece, the value's JSON text under the column name,
 *   stored as `{ "sealed": "<ciphertext>" }`;
 * - a `leaves` cell has a piece per string at a declared path, sealed in
 *   place under `<column>:<concrete path>`, so a sealed leaf cannot move to
 *   another field, another array item or another row.
 * A null (JSON, database or Prisma's markers) seals nothing. A value that
 * already looks sealed is refused as plaintext (`bad_plaintext`), as a
 * string starting with U+0001 is for a text cell. Plaintext reads as it is,
 * so rows written before sealing still read.
 */
import { FieldCryptoError, isSealedField } from "./field-crypto";
import type { JsonCell } from "./fields";

type Row = Record<string, unknown>;
type Holder = Record<string | number, unknown>;

/** A plain object or an array: never a Prisma null marker, a Date or a Decimal. */
function isContainer(value: unknown): value is Holder {
	if (Array.isArray(value)) return true;
	if (typeof value !== "object" || value === null) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/** A body as stored once sealed. */
export function isSealedBody(value: unknown): value is { sealed: string } {
	return (
		isContainer(value) &&
		!Array.isArray(value) &&
		Object.keys(value).length === 1 &&
		typeof value.sealed === "string" &&
		isSealedField(value.sealed)
	);
}

/**
 * Calls `visit` for each string at a declared path of `row[column]`. With
 * `copy`, every container on the way is replaced by a shallow copy first,
 * so writing into the holder never touches the caller's objects.
 */
function eachLeaf(
	row: Row,
	column: string,
	paths: readonly string[],
	copy: boolean,
	visit: (holder: Holder, key: string | number, path: string) => void,
): void {
	const copies = new Set<unknown>();
	const step = (
		holder: Holder,
		key: string | number,
		rest: readonly string[],
		path: readonly string[],
	): void => {
		const value = holder[key];
		if (rest.length === 0) {
			if (typeof value === "string") visit(holder, key, path.join("."));
			return;
		}
		if (!isContainer(value)) return;
		let node: Holder = value;
		if (copy && !copies.has(node)) {
			node = (Array.isArray(node) ? [...node] : { ...node }) as Holder;
			copies.add(node);
			holder[key] = node;
		}
		const [head = "", ...tail] = rest;
		if (!Array.isArray(node)) {
			if (Object.hasOwn(node, head)) step(node, head, tail, [...path, head]);
		} else if (head === "*")
			for (let i = 0; i < node.length; i++)
				step(node, i, tail, [...path, String(i)]);
	};
	for (const path of paths) step(row, column, path.split("."), []);
}

/** A piece a write seals: `put` stores the ciphertext where the text was. */
export interface PlainPiece {
	column: string;
	text: string;
	put: (sealed: string) => void;
}

/**
 * The pieces a write of `row[column]` seals. `row` must be the caller's own
 * copy: a leaves cell's containers are copied into it on the way.
 */
export function plainPieces(
	row: Row,
	column: string,
	cell: JsonCell,
): PlainPiece[] {
	if (cell.mode === "body") {
		const value = row[column];
		if (value === undefined || value === null) return [];
		if (typeof value === "object" && !isContainer(value)) return [];
		if (isSealedBody(value)) throw new FieldCryptoError("bad_plaintext");
		return [
			{
				column,
				text: JSON.stringify(value),
				put: (sealed) => {
					row[column] = { sealed };
				},
			},
		];
	}
	const pieces: PlainPiece[] = [];
	eachLeaf(row, column, cell.paths, true, (holder, key, path) => {
		const text = holder[key] as string;
		if (isSealedField(text)) throw new FieldCryptoError("bad_plaintext");
		pieces.push({
			column: `${column}:${path}`,
			text,
			put: (sealed) => {
				holder[key] = sealed;
			},
		});
	});
	return pieces;
}

/** A sealed piece of a read: `put` stores the opened text, `hide` the fallback. */
export interface SealedPiece {
	column: string;
	sealed: string;
	put: (text: string) => void;
	hide: () => void;
}

/** The sealed pieces of `row[column]`, a result the caller owns. */
export function sealedPieces(
	row: Row,
	column: string,
	cell: JsonCell,
): SealedPiece[] {
	if (cell.mode === "body") {
		const value = row[column];
		if (!isSealedBody(value)) return [];
		return [
			{
				column,
				sealed: value.sealed,
				put: (text) => {
					row[column] = JSON.parse(text);
				},
				hide: () => {
					row[column] = null;
				},
			},
		];
	}
	const pieces: SealedPiece[] = [];
	eachLeaf(row, column, cell.paths, false, (holder, key, path) => {
		const sealed = holder[key] as string;
		if (!isSealedField(sealed)) return;
		pieces.push({
			column: `${column}:${path}`,
			sealed,
			put: (text) => {
				holder[key] = text;
			},
			hide: () => {
				holder[key] = "";
			},
		});
	});
	return pieces;
}

/**
 * Whether a filter on a JSON cell reads only what stays plaintext: a JSON
 * `path` filter on a leaves cell that is neither inside a declared leaf nor
 * above one. Any other filter, and any filter on a body, compares ciphertext.
 */
export function jsonFilterAllowed(cell: JsonCell, filter: unknown): boolean {
	if (
		cell.mode !== "leaves" ||
		!isContainer(filter) ||
		!Array.isArray(filter.path)
	)
		return false;
	const path = filter.path.map(String);
	return !cell.paths.some((leaf) =>
		leaf
			.split(".")
			.slice(0, path.length)
			.every((part, i) => part === "*" || part === path[i]),
	);
}
