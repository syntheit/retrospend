/**
 * An import job's rows as the review and the commit read them. The reader
 * (the queue's CSV parser or the sidecar) stores them on the job; the commit
 * writes `expenseId` onto each row it created, which is how Undo finds the
 * batch.
 */
import type { EntryKind, ExpenseDirection, InType } from "~prisma";
import type { ImporterTransaction } from "../import-queue.service";

export const IMPORT_KINDS = [
	"expense",
	"income",
	"refund",
	"notSpending",
] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export interface StoredRow extends ImporterTransaction {
	/** A kind the file names (a `kind` column); see proposeKind. */
	kind?: string;
	/** Set by the commit on every row it created; cleared by its undo. */
	expenseId?: string;
}

function isRow(value: unknown): value is StoredRow {
	if (!value || typeof value !== "object") return false;
	const r = value as Record<string, unknown>;
	return (
		typeof r.title === "string" &&
		typeof r.amount === "number" &&
		typeof r.currency === "string" &&
		typeof r.date === "string"
	);
}

/** The job's rows; anything that is not a row is dropped (the column is free JSON). */
export function storedRows(json: unknown): StoredRow[] {
	return Array.isArray(json) ? json.filter(isRow) : [];
}

const KIND_WORDS: Record<string, ImportKind> = {
	expense: "expense",
	income: "income",
	refund: "refund",
	notspending: "notSpending",
	"not spending": "notSpending",
	transfer: "notSpending",
};

/**
 * The kind the review proposes for a row (2E.4 seam). Today only a `kind`
 * column in the file proposes one; the readers drop credits (the sidecar's
 * FilterPayments, the CSV parser's amount above 0), so every other row is an
 * Expense. When the readers keep credits, this is where they become Income
 * or Refund proposals.
 */
export function proposeKind(row: StoredRow): ImportKind {
	const word = row.kind?.trim().toLowerCase();
	return (word && KIND_WORDS[word]) || "expense";
}

/** The stored columns of each kind (M1: direction, entryKind, inType). */
export function kindColumns(kind: ImportKind): {
	direction: ExpenseDirection;
	entryKind: EntryKind;
	inType: InType | null;
} {
	switch (kind) {
		case "income":
			return { direction: "IN", entryKind: "STANDARD", inType: "INCOME" };
		case "refund":
			return { direction: "IN", entryKind: "STANDARD", inType: "REFUND" };
		case "notSpending":
			return { direction: "OUT", entryKind: "NOT_SPENDING", inType: null };
		default:
			return { direction: "OUT", entryKind: "STANDARD", inType: null };
	}
}

/** The kind of a stored expense row, the inverse of kindColumns. */
export function kindOfColumns(row: {
	direction: ExpenseDirection;
	entryKind: EntryKind;
	inType: InType | null;
}): ImportKind | null {
	if (row.entryKind === "NOT_SPENDING") return "notSpending";
	if (row.entryKind !== "STANDARD") return null;
	if (row.direction === "OUT") return "expense";
	return row.inType === "REFUND" ? "refund" : "income";
}

/** Income rows take income categories; every other kind takes expense ones. */
export function categoryKindFor(kind: ImportKind): "INCOME" | "EXPENSE" {
	return kind === "income" ? "INCOME" : "EXPENSE";
}

const ROW_SKIP = /^Row (\d+): .*skipping$/;

/**
 * Rows of the file the reader could not read (no date, no amount...). The
 * CSV parser notes each as "Row N: <reason>, skipping"; they count in the
 * file's rows and are never imported.
 */
export function unreadableCount(warnings: unknown): number {
	if (!Array.isArray(warnings)) return 0;
	const rows = new Set<string>();
	for (const w of warnings) {
		const m = typeof w === "string" ? ROW_SKIP.exec(w) : null;
		if (m?.[1]) rows.add(m[1]);
	}
	return rows.size;
}
