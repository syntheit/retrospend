import type { PrismaClient } from "~prisma";

/** Who an export is for and on which client: the web router and API v1 both pass these. */
export interface ExportContext {
	/** The user's RLS-scoped client. */
	db: PrismaClient;
	userId: string;
	/** IANA zone that dates the file name and the "Export Date" line. */
	timeZone: string;
}

export interface CsvDocument {
	csv: string;
	filename: string;
}

export interface PdfDocument {
	pdf: Buffer;
	filename: string;
}

/** A file-name fragment: letters and digits, dashes between, cut to `max`. */
export function slug(text: string, max: number): string {
	return text
		.replace(/[^a-z0-9]/gi, "-")
		.toLowerCase()
		.slice(0, max);
}

/** The date a pdf or csv row shows for a stored day. */
export function isoDay(date: Date | string): string {
	return date instanceof Date ? date.toISOString().slice(0, 10) : String(date);
}
