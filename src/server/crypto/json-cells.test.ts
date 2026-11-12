/**
 * JSON cell pieces (E2EE D11 PR 8.1). Hand-derived expectations:
 *
 *   body { title: "Cena" }, row r1     -> one piece, column responseBody, text '{"title":"Cena"}',
 *                                        stored { sealed }, opens back to the same object under r1 only
 *   leaves description.old, notes.new  -> a piece per string there, column "changes:<path>",
 *                                        ids and amounts beside them untouched
 *   leaf *.reason in a two item array  -> changes:items.0.reason and changes:items.1.reason
 *   a sealed-looking body or leaf      -> bad_plaintext
 *   null, undefined, a Prisma marker   -> nothing to seal
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type FieldAad, Keyring, openField, sealField } from "./field-crypto";
import type { JsonCell } from "./fields";
import {
	isSealedBody,
	jsonFilterAllowed,
	plainPieces,
	sealedPieces,
} from "./json-cells";

const ring = new Keyring([{ id: 1, key: randomBytes(32) }]);
const BODY: JsonCell = { mode: "body", cls: "user" };
const LEAVES: JsonCell = {
	mode: "leaves",
	cls: "instance",
	paths: ["description.old", "notes.new", "items.*.reason"],
};
const aad = (column: string, rowId: string): FieldAad => ({
	table: "t",
	column,
	rowId,
});

/** Seals what a write of `value` stores, as field-seal.ts does, and returns the stored row. */
function sealRow(column: string, cell: JsonCell, value: unknown, rowId = "r1") {
	const row: Record<string, unknown> = { id: rowId, [column]: value };
	for (const piece of plainPieces(row, column, cell))
		piece.put(sealField(ring, piece.text, aad(piece.column, rowId)));
	return row;
}

/** Opens a stored row in place, as field-open.ts does, with the AAD of `rowId`. */
function openRow(
	row: Record<string, unknown>,
	column: string,
	cell: JsonCell,
	rowId = row.id as string,
) {
	for (const piece of sealedPieces(row, column, cell))
		piece.put(openField(ring, piece.sealed, aad(piece.column, rowId)));
	return row;
}

const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (error) {
		return (error as { code?: string }).code;
	}
	return "none";
};

describe("a body cell", () => {
	it("is sealed whole as its JSON text and opens back to the same value", () => {
		const value = { title: "Cena con Ana", amount: { minor: 154500 } };
		const row = sealRow("responseBody", BODY, value);
		expect(isSealedBody(row.responseBody)).toBe(true);
		expect(JSON.stringify(row)).not.toContain("Cena");
		expect(value).toEqual({
			title: "Cena con Ana",
			amount: { minor: 154500 },
		});
		expect(openRow(row, "responseBody", BODY).responseBody).toEqual(value);
	});

	it("seals arrays, strings and numbers too, and nothing for a null", () => {
		for (const value of [[1, "a"], "text", 0, false])
			expect(
				openRow(sealRow("responseBody", BODY, value), "responseBody", BODY)
					.responseBody,
			).toEqual(value);
		class DbNull {}
		for (const value of [null, undefined, new DbNull()])
			expect(
				plainPieces({ responseBody: value }, "responseBody", BODY),
			).toEqual([]);
	});

	it("fails under another row or another column", () => {
		const row = sealRow("responseBody", BODY, { title: "Cena" });
		expect(code(() => openRow({ ...row }, "responseBody", BODY, "r2"))).toBe(
			"auth_failed",
		);
		const moved = { id: "r1", other: row.responseBody };
		expect(code(() => openRow(moved, "other", BODY))).toBe("auth_failed");
	});

	it("refuses a value that already looks sealed, and reads plaintext as it is", () => {
		const sealed = sealRow("responseBody", BODY, { a: 1 }).responseBody;
		expect(
			code(() => plainPieces({ responseBody: sealed }, "responseBody", BODY)),
		).toBe("bad_plaintext");
		const plain = { id: "r1", responseBody: { sealed: "not sealed", a: 1 } };
		expect(sealedPieces(plain, "responseBody", BODY)).toEqual([]);
		expect(
			isSealedBody({ sealed: (sealed as { sealed: string }).sealed, a: 1 }),
		).toBe(false);
	});

	it("hides as null", () => {
		const row = sealRow("responseBody", BODY, { a: 1 });
		for (const piece of sealedPieces(row, "responseBody", BODY)) piece.hide();
		expect(row.responseBody).toBeNull();
	});
});

describe("a leaves cell", () => {
	const changes = () => ({
		description: { old: "Cena", new: "Almuerzo" },
		notes: { old: null, new: "Pagó Ana" },
		items: [{ reason: "No fui", id: "p1" }, { reason: "", id: "p2" }, {}],
		paymentGroupId: "g1",
	});

	it("seals only the declared strings, in place, each under its own path", () => {
		const value = changes();
		const row = sealRow("changes", LEAVES, value);
		const stored = row.changes as ReturnType<typeof changes>;
		expect(value).toEqual(changes());
		expect(stored.description.new).toBe("Almuerzo");
		expect(stored.paymentGroupId).toBe("g1");
		expect(stored.items[0]?.id).toBe("p1");
		expect(stored.notes.old).toBeNull();
		for (const [leaf, column] of [
			[stored.description.old, "changes:description.old"],
			[stored.notes.new, "changes:notes.new"],
			[stored.items[0]?.reason, "changes:items.0.reason"],
			[stored.items[1]?.reason, "changes:items.1.reason"],
		] as const)
			expect(openField(ring, leaf as string, aad(column, "r1"))).toBeTypeOf(
				"string",
			);
		expect(openRow(row, "changes", LEAVES).changes).toEqual(changes());
	});

	it("fails a leaf moved to another path, item or row", () => {
		// A fresh copy per case: opening writes the text in place.
		const sealedChanges = () =>
			structuredClone(stored) as ReturnType<typeof changes>;
		const stored = sealRow("changes", LEAVES, changes()).changes;
		const once = sealedChanges();
		const swapped = { ...once, items: [once.items[1], once.items[0], {}] };
		expect(
			code(() => openRow({ id: "r1", changes: swapped }, "changes", LEAVES)),
		).toBe("auth_failed");
		const twice = sealedChanges();
		const moved = {
			...twice,
			notes: { old: null, new: twice.description.old },
		};
		expect(
			code(() => openRow({ id: "r1", changes: moved }, "changes", LEAVES)),
		).toBe("auth_failed");
		expect(
			code(() =>
				openRow({ id: "r2", changes: sealedChanges() }, "changes", LEAVES),
			),
		).toBe("auth_failed");
	});

	it("refuses a sealed-looking leaf and hides a leaf as an empty string", () => {
		const stored = sealRow("changes", LEAVES, changes()).changes;
		expect(
			code(() => plainPieces({ changes: stored }, "changes", LEAVES)),
		).toBe("bad_plaintext");
		const row = { id: "r1", changes: stored };
		for (const piece of sealedPieces(row, "changes", LEAVES)) piece.hide();
		expect((row.changes as ReturnType<typeof changes>).description.old).toBe(
			"",
		);
	});
});

describe("jsonFilterAllowed", () => {
	it("allows a path filter beside every leaf, and nothing else", () => {
		const allowed = (filter: unknown) => jsonFilterAllowed(LEAVES, filter);
		expect(allowed({ path: ["paymentGroupId"], equals: "g1" })).toBe(true);
		expect(allowed({ path: ["description", "new"], equals: "x" })).toBe(true);
		expect(allowed({ path: ["description", "old"], equals: "x" })).toBe(false);
		expect(allowed({ path: ["description"], equals: {} })).toBe(false);
		expect(allowed({ path: ["items", "3", "reason"] })).toBe(false);
		expect(allowed({ path: [] })).toBe(false);
		expect(allowed({ equals: {} })).toBe(false);
		expect(allowed("asc")).toBe(false);
		expect(jsonFilterAllowed(BODY, { path: ["a"], equals: 1 })).toBe(false);
	});
});
