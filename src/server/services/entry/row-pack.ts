/**
 * A stored row as JSON the undo stash can keep: every column as it was, with
 * decimals and dates tagged so they come back exact (a JSON number would
 * round a decimal, and a date would turn into text).
 */
export type Cell =
	| string
	| number
	| boolean
	| null
	| { $dec: string }
	| { $date: string };
export type Row = Record<string, Cell>;

const isDecimal = (v: unknown): v is { toFixed(): string } =>
	typeof v === "object" &&
	v !== null &&
	"toFixed" in v &&
	typeof (v as { toFixed: unknown }).toFixed === "function";

export function packRow(row: object): Row {
	const out: Row = {};
	for (const [k, v] of Object.entries(row)) {
		if (v instanceof Date) out[k] = { $date: v.toISOString() };
		else if (isDecimal(v)) out[k] = { $dec: v.toFixed() };
		else out[k] = v as Cell;
	}
	return out;
}

/** The row as the create call takes it (decimals as exact text, dates as dates). */
export function unpackRow(row: Row): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(row)) {
		if (v && typeof v === "object" && "$date" in v) out[k] = new Date(v.$date);
		else if (v && typeof v === "object" && "$dec" in v) out[k] = v.$dec;
		else out[k] = v;
	}
	return out;
}
