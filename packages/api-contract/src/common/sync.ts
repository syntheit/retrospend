import * as z from "zod";
import { cursorQuerySchema } from "./pagination";

/**
 * Delta sync (IMPLEMENTATION §2.2). A list that supports it takes
 * `?updatedSince=` and returns rows changed after that instant plus a
 * tombstone for each row deleted after it, so an offline client can apply
 * the delta without refetching. `serverTime` is the value to send as
 * `updatedSince` next time: it comes from the database clock, so client
 * clock skew never drops a change.
 */
export const updatedSinceQuerySchema = z.object({
	updatedSince: z.iso
		.datetime({ offset: true })
		.optional()
		.meta({ description: "Only rows changed after this instant." }),
});

export const syncQuerySchema = cursorQuerySchema.extend(
	updatedSinceQuerySchema.shape,
);

export const tombstoneSchema = z
	.object({
		id: z.string(),
		deletedAt: z.iso.datetime({ offset: true }),
	})
	.meta({ id: "Tombstone" });

export type Tombstone = z.infer<typeof tombstoneSchema>;

/** A sync page: changed rows, deleted ids and the next `updatedSince`. */
export function syncPageOf<T extends z.ZodType>(item: T) {
	return z.object({
		items: z.array(item),
		tombstones: z.array(tombstoneSchema),
		nextCursor: z.string().nullable(),
		serverTime: z.iso.datetime({ offset: true }),
	});
}
