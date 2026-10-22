import * as z from "zod";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/**
 * Cursor pagination query (`?cursor=&limit=`). The cursor is opaque: the
 * server encodes its own sort key and clients pass back `nextCursor`
 * untouched. Offsets are not offered, because pages shift under them when
 * rows are added.
 */
export const cursorQuerySchema = z.object({
	cursor: z
		.string()
		.min(1)
		.max(512)
		.optional()
		.meta({ description: "The nextCursor of the previous page." }),
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(MAX_PAGE_LIMIT)
		.default(DEFAULT_PAGE_LIMIT),
});

export type CursorQuery = z.infer<typeof cursorQuerySchema>;

/** One page of `item`; `nextCursor` is null on the last page. */
export function pageOf<T extends z.ZodType>(item: T) {
	return z.object({
		items: z.array(item),
		nextCursor: z.string().nullable(),
	});
}

export type Page<T> = { items: T[]; nextCursor: string | null };
