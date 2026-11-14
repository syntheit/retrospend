// Rows on disk as JSON text. Written by an explicit walk, not a JSON.stringify
// replacer: Date.toJSON runs before a replacer sees the value, so a replacer
// cannot tell a valid Date from a string, and cannot refuse an Invalid Date.
// Anything the engine's equality (equal.ts) would not read back as the same
// value is refused, which fails the commit instead of storing a changed row.

/** A value that cannot be stored. Names the field path, never a value. */
export class SerializeError extends Error {
	override readonly name = "SerializeError";
}

const DATE_KEY = "$d";

type Json =
	| string
	| number
	| boolean
	| null
	| readonly Json[]
	| { readonly [key: string]: Json };

const isPlain = (v: object) => {
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
};

function refuse(what: string, path: string): never {
	throw new SerializeError(`Cannot store ${what} at ${path || "the row"}`);
}

function walk(value: unknown, path: string): Json {
	if (value === null) return null;
	switch (typeof value) {
		case "string":
		case "boolean":
			return value;
		case "number":
			if (!Number.isFinite(value)) return refuse("a non-finite number", path);
			// -0 and 0 read the same in every figure; JSON text has no -0.
			return value === 0 ? 0 : value;
		case "object":
			break;
		default:
			return refuse(`a ${typeof value}`, path);
	}
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) return refuse("an invalid Date", path);
		return { [DATE_KEY]: value.toISOString() };
	}
	if (Array.isArray(value))
		return value.map((item, i) => {
			if (item === undefined)
				return refuse("an undefined item", `${path}[${i}]`);
			return walk(item, `${path}[${i}]`);
		});
	if (!isPlain(value)) return refuse("a class instance", path);
	const out: Record<string, Json> = {};
	for (const [key, item] of Object.entries(value)) {
		if (key === DATE_KEY) return refuse("a reserved key", path);
		// An absent optional field and an undefined one are the same row.
		if (item === undefined) continue;
		out[key] = walk(item, path ? `${path}.${key}` : key);
	}
	return out;
}

/** The JSON text of a row. Throws SerializeError for what cannot round-trip. */
export function encodeRow(row: unknown): string {
	return JSON.stringify(walk(row, ""));
}

function revive(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(revive);
	if (value === null || typeof value !== "object") return value;
	const entries = Object.entries(value);
	const only = entries.length === 1 ? entries[0] : undefined;
	if (only?.[0] === DATE_KEY) {
		const date = typeof only[1] === "string" ? new Date(only[1]) : null;
		if (!date || Number.isNaN(date.getTime()))
			throw new SerializeError("A stored date is not a date");
		return date;
	}
	return Object.fromEntries(entries.map(([k, v]) => [k, revive(v)]));
}

/** The row a text was made from. Throws SerializeError or SyntaxError on text it did not write. */
export function decodeRow(text: string): unknown {
	const parsed: unknown = JSON.parse(text);
	// Most rows hold no Date, and a walk that rebuilds every object is the slow part of a load.
	return text.includes(`"${DATE_KEY}"`) ? revive(parsed) : parsed;
}
