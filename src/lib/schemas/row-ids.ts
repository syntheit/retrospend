/**
 * The ids a web input accepts for a category or an account. A row made on a
 * server has a cuid, one a device makes offline has a client-generated UUID
 * (the same two shapes API v1's `idSchema` takes), so a web flow can read,
 * edit and use either. Every tRPC input names a category or an account
 * through these two; a bare `z.cuid()` there would refuse a device's row.
 */
import { z } from "zod";

const cuidOrUuid = z.union([z.cuid(), z.uuid()]);

export const categoryIdSchema = cuidOrUuid;

export const accountIdSchema = cuidOrUuid;
