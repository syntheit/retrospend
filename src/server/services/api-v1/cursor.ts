import { TRPCError } from "@trpc/server";
import type * as z from "zod";

/**
 * A cursor that did not come from this server, no longer parses, or names
 * a row that is gone. A TRPCError so the shared services can throw it to
 * tRPC callers too, where it is a BAD_REQUEST.
 */
export class InvalidCursorError extends TRPCError {
	constructor() {
		super({
			code: "BAD_REQUEST",
			message: "The cursor is not valid for this list",
		});
		this.name = "InvalidCursorError";
	}
}

/**
 * Opaque cursors for v1 lists: the sort key of the last row on a page as
 * base64url JSON. Clients pass `nextCursor` back untouched; a cursor that
 * fails its list's schema is refused, never read from the start.
 */
export function encodeCursor(key: unknown): string {
	return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

export function decodeCursor<T>(
	cursor: string | undefined,
	schema: z.ZodType<T>,
): T | null {
	if (cursor === undefined) return null;
	let raw: unknown;
	try {
		raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
	} catch {
		throw new InvalidCursorError();
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) throw new InvalidCursorError();
	return parsed.data;
}

/**
 * Turns `limit + 1` fetched rows into a page: the extra row only says
 * another page exists, and the cursor is the key of the last row kept.
 */
export function toPage<Row, Item>(
	rows: Row[],
	limit: number,
	keyOf: (row: Row) => unknown,
	toItem: (row: Row) => Item,
): { items: Item[]; nextCursor: string | null } {
	const kept = rows.slice(0, limit);
	const last = kept.at(-1);
	return {
		items: kept.map(toItem),
		nextCursor:
			rows.length > limit && last !== undefined
				? encodeCursor(keyOf(last))
				: null,
	};
}
