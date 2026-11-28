import * as z from "zod";
import { userText } from "../common/user-text";
import { idParamsSchema } from "../core";

/**
 * The category write bodies, apart from the routes, so the device can check a
 * body against them without the route builder (accounts/schemas.ts does the
 * same). The routes, the answers and the undo schemas are in index.ts.
 */

/** Mirrors CATEGORY_COLORS in src/lib/constants.ts (a server test keeps them equal). */
export const CATEGORY_COLORS = [
	"emerald",
	"blue",
	"sky",
	"cyan",
	"teal",
	"orange",
	"amber",
	"violet",
	"pink",
	"fuchsia",
	"indigo",
	"slate",
	"zinc",
	"lime",
	"neutral",
	"gray",
	"purple",
	"yellow",
	"stone",
	"rose",
	"red",
] as const;

export const categoryColorSchema = z
	.enum(CATEGORY_COLORS)
	.meta({ id: "CategoryColor" });

/**
 * The category's version: it moves when the name, the color, the icon or the
 * count default (excludeByDefault) changes, never for a seal or for the
 * expenses filed under it. A new category is 0.
 */
export const categoryVersionSchema = z.int().min(0).meta({
	description:
		"The category's version. It moves when its name, color, icon or excludeByDefault changes, not when expenses are filed under it or moved.",
});

/** Stored as typed (rule 6.4); only a name that is blank once trimmed is refused. */
export const categoryNameSchema = userText("category.name", 64).refine(
	(value) => value.trim().length > 0,
	{ message: "Category name is required" },
);
const iconSchema = z.string().max(50);

/** The guard a PATCH sends: the version it read, refused with 409 category_changed when the category moved. */
export const categoryExpectedVersionSchema = categoryVersionSchema
	.optional()
	.meta({
		description:
			"The `version` you last read. If the category changed since, the answer is 409 category_changed and nothing is written. Left out, nothing is checked.",
	});

const categoryKindSchema = z.enum(["expense", "income"]);

export const createCategorySchema = z
	.object({
		/** A client-made id, so a device can book the category before it is sent. */
		id: z.uuid().optional().meta({
			description:
				"A client-made id (a uuid). The category is written under it, and an id already in use is 409 id_taken with nothing written. Left out, the server makes one.",
		}),
		name: categoryNameSchema,
		color: categoryColorSchema,
		icon: iconSchema.optional(),
		/** Whether it files expenses or income. Left out, expense. It is set here and never edited. */
		kind: categoryKindSchema.optional(),
		excludeByDefault: z.boolean().optional(),
	})
	.meta({ id: "CreateCategory" });

export const updateCategorySchema = z
	.object({
		name: categoryNameSchema,
		color: categoryColorSchema,
		/** Null removes the icon. */
		icon: iconSchema.nullable(),
		excludeByDefault: z.boolean(),
	})
	.partial()
	.meta({ id: "UpdateCategory" });

/** PATCH /categories/{id}: the fields to change, the guard, and the one field it refuses. */
export const patchCategorySchema = idParamsSchema
	.extend({
		...updateCategorySchema.shape,
		expectedVersion: categoryExpectedVersionSchema,
		kind: categoryKindSchema.optional().meta({
			description:
				"Never accepted. A category's kind is set when it is made; sending it is a validation error.",
		}),
	})
	.refine((value) => value.kind === undefined, {
		path: ["kind"],
		message: "A category's kind cannot be changed",
	})
	.refine(
		(value) =>
			value.name !== undefined ||
			value.color !== undefined ||
			value.icon !== undefined ||
			value.excludeByDefault !== undefined,
		{ message: "Name at least one field to change" },
	);
