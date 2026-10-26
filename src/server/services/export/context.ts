import { dayKey } from "@retrospend/domain/time-zone";
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

/**
 * The day a pdf or csv row shows for a stored moment: the day on the user's
 * screen, so a late-evening expense is not pushed to tomorrow (UTC).
 */
export function isoDay(date: Date | string, timeZone?: string): string {
	return date instanceof Date ? dayKey(date, timeZone) : String(date);
}
