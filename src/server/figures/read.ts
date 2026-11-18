import type { FiguresBasis } from "@retrospend/api-contract";
import { db } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import { readRatesAsOf } from "~/server/services/api-v1/rate-sync";
import { readCutCursor, readSeenCursor } from "~/server/services/sync/changes";
import { figureSettingsOf } from "~/server/services/sync/snapshots";
import { Prisma } from "~prisma";
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

/**
 * readFigures plus what the reading was true of (the `basis` of GET /figures),
 * all in one repeatable-read transaction: the figures, the settings and the
 * rate stamp share one snapshot, so a settings or rate write that commits
 * meanwhile is in all of them or none, and `asOf` bounds every row they read.
 * The basis is null when the user row is not visible (nothing to compare to).
 * `at` is the instant taken just before the figure reads. Figures read their
 * own clock a few milliseconds later, so a compare must skip a check whose `at`
 * lies near a period edge.
 */
export async function readFiguresWithBasis(
	userId: string,
	ids: readonly string[],
	narrowing: FigureNarrowing = {},
): Promise<{
	readings: ReadonlyMap<string, FigureReading>;
	basis: FiguresBasis | null;
}> {
	const definitions = ids.map((id) => figures.get(id));
	return userTransaction(
		db,
		userId,
		async (tx) => {
			const at = new Date();
			const readings = await readFiguresIn(tx, definitions, {
				...narrowing,
				userId,
			});
			const user = await tx.user.findUnique({
				where: { id: userId },
				select: {
					homeCurrency: true,
					timeZone: true,
					fiscalMonthStartDay: true,
				},
			});
			if (!user) return { readings, basis: null };
			const settings = figureSettingsOf(user);
			return {
				readings,
				basis: {
					asOf: await readSeenCursor(tx),
					cut: await readCutCursor(tx),
					at: at.toISOString(),
					ratesAsOf: await readRatesAsOf(tx),
					home: settings.homeCurrency,
					timeZone: settings.timeZone,
					startDay: settings.startDay,
				},
			};
		},
		{ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
	);
}
