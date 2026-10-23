/**
 * What the page knows about a picked file before the server reads it: its
 * kind, whether it fits the 10 MB limit, and, for a CSV, whether its header
 * is the Retrospend format (then it skips "Read it", like a saved mapping).
 * Nothing here parses rows or touches amounts; the server reads the file.
 */
import { parseRawCsv } from "~/lib/csv";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ACCEPT = ".csv,.xlsx,.pdf,text/csv,application/pdf";

export type FileKind = "csv" | "xlsx" | "pdf";

export function fileKindOf(name: string): FileKind | null {
	const lower = name.toLowerCase();
	if (lower.endsWith(".csv")) return "csv";
	if (lower.endsWith(".xlsx")) return "xlsx";
	if (lower.endsWith(".pdf")) return "pdf";
	return null;
}

/** The columns the Retrospend CSV reader needs, and the ones it also reads. */
export const REQUIRED_COLUMNS = [
	"date",
	"title",
	"amount",
	"currency",
] as const;
export const OPTIONAL_COLUMNS = ["category", "kind"] as const;
export type Column =
	| (typeof REQUIRED_COLUMNS)[number]
	| (typeof OPTIONAL_COLUMNS)[number];

export interface CsvHeader {
	/** Each column the reader uses, with the file's sample value (or null). */
	readonly columns: readonly { column: Column; sample: string | null }[];
	/** Every required column is there. */
	readonly retrospend: boolean;
}

/** The header and first row of a CSV, as the server's reader will see them. */
export function readCsvHeader(text: string): CsvHeader | null {
	const { data } = parseRawCsv(text.split(/\r?\n/).slice(0, 2).join("\n"));
	const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
	if (!firstLine.trim()) return null;
	const names = new Set(
		firstLine
			.split(",")
			.map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase()),
	);
	const sample = data[0] ?? {};
	const columns = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS].map((column) => ({
		column,
		sample: names.has(column) ? (sample[column]?.trim() ?? "") : null,
	}));
	return {
		columns,
		retrospend: REQUIRED_COLUMNS.every((c) => names.has(c)),
	};
}

/** The file as base64, how the queue takes it (createJob). */
export async function base64Of(file: Blob): Promise<string> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk)
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	return btoa(binary);
}

/** The template "Download CSV template" saves: the header and one example row. */
export const TEMPLATE_CSV =
	"date,title,amount,currency,category,kind\n2026-10-19,Coffee,3500,ARS,Food,expense\n";
