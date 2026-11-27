/**
 * The ids a web input accepts for a category, an account or a project. A row
 * made on a server has a cuid, one a device makes offline has a
 * client-generated UUID, so a web flow can read, edit and use either. Every
 * tRPC input names one of these rows through these schemas; a bare
 * `z.cuid()` there would refuse a device's row. They are narrower than API
 * v1's `idSchema` (any string up to 64 characters) on purpose: the web keeps
 * a shape check.
 */
import { z } from "zod";

const cuidOrUuid = z.union([z.cuid(), z.uuid()]);

export const categoryIdSchema = cuidOrUuid;

export const accountIdSchema = cuidOrUuid;

export const projectIdSchema = cuidOrUuid;
