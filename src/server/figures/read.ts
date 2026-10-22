import { db } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import {
	type FigureNarrowing,
	type FigureReading,
	figures,
	readFiguresIn,
} from "./registry";

/**
 * Reads figures for one user outside any mutation (web, /api/v1, the audit).
 * Wraps the reads in a userTransaction because createUserScopedDb only
 * intercepts model calls: a figure using `$queryRaw` would otherwise run
 * without RLS. Unknown ids fail before the transaction opens.
 */
export async function readFigures(
	userId: string,
	ids: readonly string[],
	narrowing: FigureNarrowing = {},
): Promise<ReadonlyMap<string, FigureReading>> {
	const definitions = ids.map((id) => figures.get(id));
	return userTransaction(db, userId, (tx) =>
		readFiguresIn(tx, definitions, { ...narrowing, userId }),
	);
}
