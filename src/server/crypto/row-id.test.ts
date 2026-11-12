import { describe, expect, it } from "vitest";
import { z } from "zod";
import { editAccountSchema } from "~/server/services/accounts/input";
import { readSchema } from "~/test/prisma-schema";
import { FieldCryptoError } from "./field-crypto";
import { FIELD_MAP, JSON_CELLS } from "./fields";
import { ID_DEFAULT, newCuid, newRowId } from "./row-id";

describe("ID_DEFAULT", () => {
	it("says cuid exactly for the mapped and JSON models whose id is @default(cuid())", () => {
		const models = new Map(readSchema().map((m) => [m.name, m]));
		const expected = Object.fromEntries(
			[...Object.keys(FIELD_MAP), ...Object.keys(JSON_CELLS)].map((name) => {
				const id = models.get(name)?.fields.find((f) => f.name === "id");
				if (!id) throw new Error(`${name} has no id field`);
				return [
					name,
					id.attributes.includes("@default(cuid())") ? "cuid" : "none",
				];
			}),
		);
		expect(ID_DEFAULT).toEqual(expected);
	});
});

describe("newCuid", () => {
	it("makes unique ids that pass z.cuid() and the id schemas", () => {
		const ids = Array.from({ length: 10_000 }, newCuid);
		expect(new Set(ids).size).toBe(ids.length);
		const cuid = z.cuid();
		for (const id of ids) expect(cuid.safeParse(id).success).toBe(true);
		const [first] = ids;
		expect(editAccountSchema.shape.id.safeParse(first).success).toBe(true);
		// What a UUID id would fail (the reason ids are not randomUUID()).
		expect(cuid.safeParse(crypto.randomUUID()).success).toBe(false);
	});
});

describe("newRowId", () => {
	it("makes a cuid for a cuid model and refuses a model whose callers name the id", () => {
		expect(z.cuid().safeParse(newRowId("Expense")).success).toBe(true);
		expect(() => newRowId("Payment")).toThrow(FieldCryptoError);
		expect(() => newRowId("Payment")).toThrow(
			expect.objectContaining({ code: "missing_row_id" }),
		);
	});
});
