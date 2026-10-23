import { describe, expect, it } from "vitest";
import {
	commitRows,
	countsOf,
	initialChoices,
	type ReviewRow,
	withAllKept,
	withChoice,
	withMatched,
} from "./choices";
import { fileKindOf, readCsvHeader } from "./file";

const ARS = (minor: number) => ({ minor, currency: "ARS" });
const row = (index: number, extra: Partial<ReviewRow> = {}): ReviewRow => ({
	index,
	date: "2026-10-19",
	title: `Row ${index}`,
	amount: ARS(100),
	home: ARS(100),
	rate: null,
	fileCategory: "",
	categoryId: null,
	kind: "expense",
	duplicate: false,
	possible: null,
	noRate: false,
	...extra,
});

const ROWS = [
	row(0, { fileCategory: "Gastro" }),
	row(1, { duplicate: true }),
	row(2, { noRate: true, home: null }),
	row(3, { kind: "income", fileCategory: "Gastro" }),
	row(4, { fileCategory: "Cuotas", categoryId: "cat-club" }),
];

describe("review choices", () => {
	it("keeps what the import can create and counts every row once", () => {
		const choices = initialChoices(ROWS);
		expect(countsOf(ROWS, choices)).toEqual({
			kept: 3,
			unchecked: 0,
			duplicates: 1,
		});
		const skipped = withChoice(choices, 0, { keep: false });
		expect(countsOf(ROWS, skipped)).toEqual({
			kept: 2,
			unchecked: 1,
			duplicates: 1,
		});
		expect(countsOf(ROWS, withAllKept(ROWS, choices, false)).kept).toBe(0);
	});

	it("never sends a duplicate or a row without a rate as kept", () => {
		const choices = withChoice(initialChoices(ROWS), 1, { keep: true });
		const sent = commitRows(ROWS, choices);
		expect(sent.filter((r) => r.keep).map((r) => r.index)).toEqual([0, 3, 4]);
		expect(sent[3]).toEqual({
			index: 3,
			keep: true,
			categoryId: null,
			kind: "income",
		});
	});

	it("matches a file category on rows of a fitting kind only", () => {
		const matched = withMatched(
			ROWS,
			initialChoices(ROWS),
			{ Gastro: "cat-restaurants" },
			() => true,
		);
		expect(matched[0]?.categoryId).toBe("cat-restaurants");
		// An income row never takes an expense category.
		expect(matched[3]?.categoryId).toBeNull();
		// A row that already has one keeps it.
		expect(matched[4]?.categoryId).toBe("cat-club");
	});

	it("keeps decisions when the review reloads (a currency change)", () => {
		const first = withChoice(initialChoices(ROWS), 0, { keep: false });
		expect(initialChoices(ROWS, first)[0]?.keep).toBe(false);
	});
});

describe("file", () => {
	it("knows the three kinds it reads", () => {
		expect(fileKindOf("Galicia Oct.CSV")).toBe("csv");
		expect(fileKindOf("resumen.pdf")).toBe("pdf");
		expect(fileKindOf("sheet.xlsx")).toBe("xlsx");
		expect(fileKindOf("notes.txt")).toBeNull();
	});

	it("reads a Retrospend header and its sample row", () => {
		const header = readCsvHeader(
			"Date,Title,Amount,Currency,Category\n2026-10-19,COTO,38200,ARS,Supermercado\n",
		);
		expect(header?.retrospend).toBe(true);
		expect(header?.columns.find((c) => c.column === "title")?.sample).toBe(
			"COTO",
		);
		expect(header?.columns.find((c) => c.column === "kind")?.sample).toBeNull();
	});

	it("says a bank's own header is not the Retrospend format", () => {
		expect(
			readCsvHeader("Fecha,Descripcion,Importe\n19/10/2026,COTO,38.200\n")
				?.retrospend,
		).toBe(false);
	});
});
