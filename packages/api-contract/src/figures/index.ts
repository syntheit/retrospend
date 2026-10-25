import * as z from "zod";
import { v1 } from "../common/meta";
import { figureSchema } from "../common/money";
import { glanceSchema } from "./glance";

export * from "./glance";

export const MAX_FIGURE_IDS = 50;

const FIGURE_ID_LIST = /^[a-z][A-Za-z0-9.]*(,[a-z][A-Za-z0-9.]*)*$/;

/** Splits the `ids` query (`a,b`) into figure ids. */
export function parseFigureIds(ids: string): string[] {
	return [...new Set(ids.split(","))];
}

export const figuresQuerySchema = z.object({
	ids: z
		.string()
		.max(2000)
		.regex(FIGURE_ID_LIST)
		.meta({
			description: `Comma-separated figure ids, at most ${MAX_FIGURE_IDS}.`,
			examples: ["owed.owedToYou,owed.youOwe"],
		}),
	projectId: z.string().optional(),
	personId: z.string().optional(),
	accountId: z.string().optional(),
	/** For insights.byCategory and the other per-category figures. */
	categoryId: z.string().optional(),
	/** For insights.byMonth: a fiscal month label such as 2026-10. */
	month: z
		.string()
		.regex(/^\d{4}-\d{2}$/)
		.optional(),
	envelopeId: z.string().optional(),
});

export const figuresResultSchema = z.object({
	figures: z.array(figureSchema),
});

/**
 * GET /figures reads named numbers from the figures registry, the same
 * definitions the web shows and the e2e display audit compares against.
 * A narrowing (projectId, personId, accountId, categoryId, month, envelopeId) applies only to figures
 * that honor it. Unknown ids are `not_found`.
 */
export const figuresContract = {
	read: v1
		.route({
			method: "GET",
			path: "/figures",
			operationId: "getFigures",
			tags: ["Figures"],
			summary: "Read figures by id",
		})
		.meta({ scope: "read" })
		.input(figuresQuerySchema)
		.output(figuresResultSchema),
	glance: v1
		.route({
			method: "GET",
			path: "/figures/glance",
			operationId: "getGlance",
			tags: ["Figures"],
			summary: "Home's glance",
			description:
				"Spent this period against the last by the same day, the budget verdict and Left to spend when a book exists, Owed to you and You owe (never netted) and net worth. Spent for any filter is the `total` of GET /expenses; spent alone is GET /figures?ids=spent.",
		})
		.meta({ scope: "read" })
		.output(glanceSchema),
};
