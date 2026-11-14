/**
 * The shape check of a budget block (GET /sync/shares?budget=1) before a device
 * keeps it. The server's zod output schema already holds a response to this
 * shape; the check is the device's own, so a body that is corrupt or from a
 * server it does not understand never reaches a store, where the figures would
 * read a fractional amount or an impossible date. It checks types and ranges
 * only: whether the block is right is the server's answer and is never
 * re-derived here. Any fault throws InvalidInputError, which refuses the body.
 */
import { InvalidInputError } from "./port";

type Obj = Readonly<Record<string, unknown>>;

function fault(path: string, what: string): never {
	throw new InvalidInputError(`The budget block's ${path} ${what}`);
}

function obj(value: unknown, path: string): Obj {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		fault(path, "is not an object");
	return value as Obj;
}

function list(value: unknown, path: string): unknown[] {
	if (!Array.isArray(value)) fault(path, "is not a list");
	return value as unknown[];
}

function str(o: Obj, key: string, path: string): string {
	const v = o[key];
	if (typeof v !== "string") fault(`${path}.${key}`, "is not text");
	return v as string;
}

function nonEmpty(o: Obj, key: string, path: string): void {
	if (str(o, key, path) === "") fault(`${path}.${key}`, "is empty");
}

const strOrNull = (o: Obj, key: string, path: string) =>
	o[key] === null ? null : str(o, key, path);

function optional(o: Obj, key: string, check: () => void) {
	if (o[key] !== undefined) check();
}

function bool(o: Obj, key: string, path: string): void {
	if (typeof o[key] !== "boolean")
		fault(`${path}.${key}`, "is not true or false");
}

/** Whole minor units, as a JSON number can carry them. */
function minor(o: Obj, key: string, path: string): void {
	if (!Number.isSafeInteger(o[key]))
		fault(`${path}.${key}`, "is not whole minor units");
}

function minorOrNull(o: Obj, key: string, path: string): void {
	if (o[key] !== null) minor(o, key, path);
}

/** A YYYYMM month key. */
function month(o: Obj, key: string, path: string): void {
	const v = o[key];
	if (
		!Number.isInteger(v) ||
		(v as number) < 100_000 ||
		(v as number) > 999_912 ||
		(v as number) % 100 < 1 ||
		(v as number) % 100 > 12
	)
		fault(`${path}.${key}`, "is not a month");
}

/** A calendar date, YYYY-MM-DD, that exists. */
function isoDate(o: Obj, key: string, path: string): void {
	const v = o[key];
	// A month 13 is an invalid Date, whose toISOString throws, so it is checked first.
	const at =
		typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
			? new Date(`${v}T00:00:00Z`)
			: null;
	if (
		at === null ||
		Number.isNaN(at.getTime()) ||
		at.toISOString().slice(0, 10) !== v
	)
		fault(`${path}.${key}`, "is not a date");
}

function isoDateOrNull(o: Obj, key: string, path: string): void {
	if (o[key] !== null) isoDate(o, key, path);
}

function each(
	value: unknown,
	path: string,
	check: (row: Obj, at: string) => void,
): void {
	list(value, path).forEach((row, i) => {
		check(obj(row, `${path}[${i}]`), `${path}[${i}]`);
	});
}

function strings(value: unknown, path: string): void {
	for (const [i, v] of list(value, path).entries())
		if (typeof v !== "string") fault(`${path}[${i}]`, "is not text");
}

function missingRate(r: Obj, at: string) {
	str(r, "currency", at);
	strOrNull(r, "rateType", at);
	isoDate(r, "date", at);
	optional(r, "rowId", () => str(r, "rowId", at));
}

function approximateRow(r: Obj, at: string) {
	str(r, "rowId", at);
	isoDate(r, "date", at);
}

function event(e: Obj, at: string) {
	for (const k of ["id", "counterparty", "currency"]) str(e, k, at);
	isoDate(e, "date", at);
	month(e, "month", at);
	minor(e, "native", at);
	optional(e, "notInBudget", () => bool(e, "notInBudget", at));
	const settlement = () => {
		str(e, "status", at);
		minor(e, "cash", at);
		optional(e, "isOffset", () => bool(e, "isOffset", at));
	};
	switch (e.kind) {
		case "FRONT":
			minor(e, "value", at);
			optional(e, "shareStatus", () => str(e, "shareStatus", at));
			return;
		case "OWE":
			str(e, "status", at);
			return;
		case "UNFRONT":
			return;
		case "RECV":
			settlement();
			return;
		case "PAY":
			settlement();
			optional(e, "forgiven", () => bool(e, "forgiven", at));
			return;
		case "FORGIVE":
			str(e, "status", at);
			strOrNull(e, "envelopeId", at);
			return;
		default:
			fault(`${at}.kind`, "is not an event kind");
	}
}

/** The splits block: every amount, date, month and id the figures read. */
function splits(value: unknown): void {
	const s = obj(value, "splits");
	each(s.shares, "splits.shares", (r, at) => {
		str(r, "id", at);
		month(r, "month", at);
		isoDate(r, "date", at);
		minor(r, "minor", at);
		str(r, "source", at);
		strOrNull(r, "categoryId", at);
		optional(r, "envelopeId", () => strOrNull(r, "envelopeId", at));
		optional(r, "pending", () => bool(r, "pending", at));
	});
	each(s.effects, "splits.effects", (r, at) => {
		for (const k of ["eventId", "counterparty", "currency", "term"])
			str(r, k, at);
		isoDate(r, "date", at);
		month(r, "month", at);
		minor(r, "minor", at);
		minor(r, "fx", at);
		optional(r, "envelopeId", () => strOrNull(r, "envelopeId", at));
	});
	each(s.balances, "splits.balances", (r, at) => {
		str(r, "counterparty", at);
		str(r, "currency", at);
		minor(r, "native", at);
		minor(r, "basis", at);
		isoDateOrNull(r, "oldestOpen", at);
	});
	each(s.ignored, "splits.ignored", (r, at) => {
		str(r, "eventId", at);
		str(r, "reason", at);
		minor(r, "native", at);
	});
	each(s.events, "splits.events", event);
	each(s.pending, "splits.pending", (r, at) => {
		for (const k of ["id", "counterparty", "currency"]) str(r, k, at);
		minor(r, "native", at);
		minorOrNull(r, "cash", at);
		isoDate(r, "date", at);
	});
	strings(s.unresolved, "splits.unresolved");
	strings(s.notInBudget, "splits.notInBudget");
	each(s.missingRates, "splits.missingRates", missingRate);
	each(s.approximate, "splits.approximate", approximateRow);
	each(s.checkpointMissingRates, "splits.checkpointMissingRates", missingRate);
	each(s.checkpointApproximate, "splits.checkpointApproximate", approximateRow);
}

/**
 * Checks a whole budget block before anything is written: the book, the
 * valuation key and the cursor as text (the book and the cursor not empty),
 * each frozen value, and everything in the splits.
 */
export function checkBudgetBlock(block: unknown): void {
	const b = obj(block, "block");
	nonEmpty(b, "bookId", "block");
	str(b, "valuationKey", "block");
	nonEmpty(b, "asOf", "block");
	const keys = new Set<string>();
	each(b.frozen, "frozen", (f, at) => {
		const key = str(f, "key", at);
		if (keys.has(key)) fault(`${at}.key`, "repeats an earlier key");
		keys.add(key);
		minor(f, "minor", at);
		bool(f, "approximate", at);
	});
	splits(b.splits);
}
