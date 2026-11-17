import { jsonColumns, mappedColumns } from "~/server/crypto/fields";

const snake = (word: string) =>
	word.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/**
 * Every column word of the sealing map (FIELD_MAP and JSON_CELLS), as the
 * guard tests (userTextRawSql, userTextModelQueries) match it: the Prisma
 * field name, and its snake_case form for SQL. Built from the map so a new
 * mapped column is guarded with no edit here.
 */
export const userTextColumns = (): string[] =>
	[
		...new Set(
			[...mappedColumns(), ...jsonColumns()].flatMap(([, column]) => [
				column,
				snake(column),
			]),
		),
	].sort();

export const USER_TEXT_COLUMNS: readonly string[] = userTextColumns();
