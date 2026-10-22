import * as z from "zod";

/**
 * The list filter (`?filter=`), shared with the web's filter bar. The
 * grammar itself lands with the expenses list (S3b, G2): until then the
 * parameter is reserved so no route claims the name for something else,
 * and a route that accepts it must reject a value it cannot parse with
 * `invalid_filter` rather than ignore it.
 */
export const FILTER_MAX_LENGTH = 2000;

export const filterQuerySchema = z.object({
	filter: z.string().max(FILTER_MAX_LENGTH).optional().meta({
		description:
			"Filter expression in the web filter grammar (defined with the expenses list).",
	}),
});

export type FilterQuery = z.infer<typeof filterQuerySchema>;
