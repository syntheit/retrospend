/**
 * The footprint a set-up signs (setup-undo.service.ts) must cover everything
 * a book owns, or an undo could delete work it never saw. This holds it to
 * the schema: every table with a relation to BudgetBook is either in the
 * footprint or on the short list of caches and pointers left out on purpose,
 * and every BudgetBook column is either digested or on the list of columns a
 * page open touches. A new relation or column fails here until it is placed.
 */
import { describe, expect, it } from "vitest";
import { readSchema } from "~/test/prisma-schema";
import {
	BOOK_DIGEST_COLUMNS,
	BOOK_IGNORED_COLUMNS,
	FOOTPRINT_TABLES,
} from "./setup-undo.service";

const models = readSchema();
const book = models.find((m) => m.name === "BudgetBook");
const modelNames = new Set(models.map((m) => m.name));

/** Relations of BudgetBook that are not a table the book owns, or are caches. */
const NOT_OWNED_ROWS: Record<string, string> = {
	// The user the book belongs to: not deleted with it.
	createdBy: "the creator",
	// A pointer to the envelope inside the book (the book's own column digests it).
	defaultEnvelope: "an envelope of the book",
	// The row setup writes next to the book: its id and update time are in the footprint.
	startingBalanceExpense: "the starting balance expense",
	// Caches the budget rewrites whenever a page reads it.
	dirtyMarks: "budget_dirty",
	rowValues: "budget_row_value",
};

describe("the footprint covers every table a book owns", () => {
	it("finds the BudgetBook model", () => {
		expect(book).toBeDefined();
	});

	it("each relation to another table is in the footprint or left out on purpose", () => {
		const relations = (book?.fields ?? []).filter((f) =>
			modelNames.has(f.type),
		);
		const tables = relations
			.filter((f) => !(f.name in NOT_OWNED_ROWS))
			.map((f) => models.find((m) => m.name === f.type)?.table);
		expect([...tables].sort()).toEqual([...FOOTPRINT_TABLES].sort());
		// Every name on the short list is a real relation, so the list cannot rot.
		for (const name of Object.keys(NOT_OWNED_ROWS))
			expect(
				relations.some((f) => f.name === name),
				name,
			).toBe(true);
	});

	it("each BudgetBook column is digested or ignored, never both, never neither", () => {
		const columns = (book?.fields ?? [])
			.filter((f) => !modelNames.has(f.type))
			.map((f) => f.name);
		const classified = [...BOOK_DIGEST_COLUMNS, ...BOOK_IGNORED_COLUMNS];
		expect([...classified].sort()).toEqual([...columns].sort());
		expect(new Set(classified).size).toBe(classified.length);
	});

	it("only a page open or a rename is ignored", () => {
		expect([...BOOK_IGNORED_COLUMNS].sort()).toEqual([
			"dirtyFromMonth",
			"lastOpenedAt",
			"name",
			"updatedAt",
			"welcomeBackFrom",
		]);
	});
});
