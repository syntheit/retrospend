import {
	parseSearchTypes,
	type SearchHit,
	type SearchResult,
	type SearchType,
	type searchQuerySchema,
} from "@retrospend/api-contract";
import * as z from "zod";
import {
	searchCategories,
	searchExpenses,
	searchPeople,
	searchProjects,
} from "~/server/services/search.service";
import type { CategoryColor } from "~prisma";
import { type Caller, isoDay, moneyOf } from "./caller";
import { decodeCursor, encodeCursor } from "./cursor";

/**
 * GET /search: one group per type. A group's cursor carries its type and
 * sort key, so following it answers only that group.
 */

type Group = SearchResult["groups"][number];

const cursorSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("expenses"),
		key: z.object({ date: z.iso.datetime(), id: z.string() }),
	}),
	z.object({
		type: z.literal("people"),
		key: z.object({
			name: z.string(),
			participantType: z.string(),
			id: z.string(),
		}),
	}),
	z.object({
		type: z.literal("projects"),
		key: z.object({ name: z.string(), id: z.string() }),
	}),
	z.object({
		type: z.literal("categories"),
		key: z.object({ name: z.string(), id: z.string() }),
	}),
]);

type Cursor = z.infer<typeof cursorSchema>;
type KeyOf<T extends SearchType> = Extract<Cursor, { type: T }>["key"];

/** Fetches limit + 1 rows, keeps limit, and names the next page by its last key. */
function group<T extends SearchType, Row>(
	type: T,
	rows: Row[],
	limit: number,
	keyOf: (row: Row) => KeyOf<T>,
	toHit: (row: Row) => SearchHit,
): Group {
	const kept = rows.slice(0, limit);
	const last = kept.at(-1);
	return {
		type,
		items: kept.map(toHit),
		nextCursor:
			rows.length > limit && last !== undefined
				? encodeCursor({ type, key: keyOf(last) })
				: null,
	};
}

async function searchOne(
	caller: Caller,
	type: SearchType,
	q: string,
	limit: number,
	cursor: Cursor | null,
): Promise<Group> {
	const { db } = caller;
	const me = caller.principal.userId;
	const take = limit + 1;
	const after = <T extends SearchType>(t: T) =>
		cursor?.type === t ? (cursor.key as KeyOf<T>) : null;
	switch (type) {
		case "expenses": {
			const key = after("expenses");
			const rows = await searchExpenses(db, me, q, {
				after: key,
				take,
			});
			return group(
				"expenses",
				rows,
				limit,
				(r) => ({ date: r.date.toISOString(), id: r.id }),
				(r) => ({
					type: "expense",
					id: r.id,
					title: r.title,
					date: isoDay(r.date),
					amount: moneyOf(r.amount, r.currency),
					categoryId: r.categoryId,
				}),
			);
		}
		case "people": {
			const rows = await searchPeople(db, me, q, {
				after: after("people"),
				take,
			});
			return group(
				"people",
				rows,
				limit,
				(r) => ({ name: r.name, participantType: r.participantType, id: r.id }),
				(r) => ({ type: "person", ...r }),
			);
		}
		case "projects": {
			const rows = await searchProjects(db, me, q, {
				after: after("projects"),
				take,
			});
			return group(
				"projects",
				rows,
				limit,
				(r) => ({ name: r.name, id: r.id }),
				(r) => ({ type: "project", ...r }),
			);
		}
		case "categories": {
			const rows = await searchCategories(db, me, q, {
				after: after("categories"),
				take,
			});
			return group(
				"categories",
				rows,
				limit,
				(r) => ({ name: r.name, id: r.id }),
				(r) => ({ type: "category", ...r, color: r.color as CategoryColor }),
			);
		}
	}
}

export async function search(
	caller: Caller,
	input: z.infer<typeof searchQuerySchema>,
): Promise<SearchResult> {
	const cursor = decodeCursor(input.cursor, cursorSchema);
	const types = cursor ? [cursor.type] : parseSearchTypes(input.types);
	const groups: Group[] = [];
	// One at a time: each runs in its own transaction on the shared pool.
	for (const type of types) {
		groups.push(await searchOne(caller, type, input.q, input.limit, cursor));
	}
	return { groups };
}
