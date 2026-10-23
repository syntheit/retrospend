import * as z from "zod";
import { v1 } from "../common/meta";
import { moneySchema } from "../common/money";
import { categoryColorSchema } from "../categories";
import { idSchema } from "../core";

export const SEARCH_TYPES = [
	"expenses",
	"people",
	"projects",
	"categories",
] as const;

export type SearchType = (typeof SEARCH_TYPES)[number];

export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 50;

const TYPE_LIST = new RegExp(
	`^(${SEARCH_TYPES.join("|")})(,(${SEARCH_TYPES.join("|")}))*$`,
);

/** Splits `types` (`expenses,people`) into search types, all when absent. */
export function parseSearchTypes(types: string | undefined): SearchType[] {
	if (!types) return [...SEARCH_TYPES];
	return SEARCH_TYPES.filter((t) => types.split(",").includes(t));
}

export const searchQuerySchema = z.object({
	q: z.string().trim().min(1).max(100).meta({
		description:
			"Matched anywhere in the text, ignoring case and accents (cafe finds Café).",
	}),
	types: z
		.string()
		.regex(TYPE_LIST)
		.optional()
		.meta({
			description: `Comma-separated, any of ${SEARCH_TYPES.join(", ")}. Default all.`,
		}),
	cursor: z.string().min(1).max(512).optional().meta({
		description:
			"A group's nextCursor. It names its own type, so the answer holds only that group.",
	}),
	limit: z.coerce
		.number()
		.int()
		.min(1)
		.max(SEARCH_MAX_LIMIT)
		.default(SEARCH_DEFAULT_LIMIT)
		.meta({ description: "Hits per group." }),
});

export const expenseHitSchema = z.object({
	type: z.literal("expense"),
	id: idSchema,
	title: z.string(),
	date: z.iso.date(),
	amount: moneySchema,
	categoryId: idSchema.nullable(),
});

export const personHitSchema = z.object({
	type: z.literal("person"),
	/** A Retrospend user, or a person the caller added by name (shadow). */
	participantType: z.enum(["user", "shadow"]),
	id: idSchema,
	name: z.string(),
	username: z.string().nullable(),
});

export const projectHitSchema = z.object({
	type: z.literal("project"),
	id: idSchema,
	name: z.string(),
	status: z.enum(["ACTIVE", "ARCHIVED"]),
});

export const categoryHitSchema = z.object({
	type: z.literal("category"),
	id: idSchema,
	name: z.string(),
	color: categoryColorSchema,
});

export const searchHitSchema = z
	.discriminatedUnion("type", [
		expenseHitSchema,
		personHitSchema,
		projectHitSchema,
		categoryHitSchema,
	])
	.meta({ id: "SearchHit" });

export type SearchHit = z.infer<typeof searchHitSchema>;

export const searchGroupSchema = z
	.object({
		type: z.enum(SEARCH_TYPES),
		items: z.array(searchHitSchema),
		nextCursor: z.string().nullable(),
	})
	.meta({ id: "SearchGroup" });

export const searchResultSchema = z
	.object({ groups: z.array(searchGroupSchema) })
	.meta({ id: "SearchResult" });

export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchContract = {
	search: v1
		.route({
			method: "GET",
			path: "/search",
			operationId: "search",
			tags: ["Search"],
			summary: "Find expenses, people, projects and categories",
			description:
				"One group per requested type, always in the order expenses, people, projects, categories. Expenses come newest first; the rest by name.",
		})
		.meta({ scope: "read" })
		.input(searchQuerySchema)
		.output(searchResultSchema),
};
