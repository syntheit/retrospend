/**
 * The entry figures (IMPLEMENTATION §2.4): what one Activity row shows,
 * read by the row's id (`entryId`: a personal expense id, `shared:<id>` or
 * `payment:<key>`, the ids the list gives its rows). They shape the row
 * with the code listV2 shapes it with, so the list, the read view and the
 * API cannot disagree.
 *
 * - `entry.amount`: the row's amount in its own currency.
 * - `entry.share`: your share of a shared expense (home currency when it
 *   has a rate, the expense's own otherwise). Empty for any other row.
 *
 * This file is the server loader: it reads the row's stored rows with SQL and
 * hands them to the pure shaping in @retrospend/domain/activity-rows, which a
 * device runs over its own rows.
 */
import {
	type ActivityRowDTO,
	entryAmountOf,
	entryRowFrom,
	entryShareOf,
	rowKeyFromEntryId,
} from "@retrospend/domain/activity-rows";
import { findExchangeRate } from "~/server/exchange-rates";
import { FigureNarrowingError } from "~/server/figures/narrowing";
import type {
	FigureDb,
	FigureDefinition,
	FigureScope,
} from "~/server/figures/registry";
import { loadActivityInputs } from "~/server/services/expense-list/rows";

async function rowOf(
	db: FigureDb,
	scope: FigureScope,
	figure: string,
): Promise<ActivityRowDTO | null> {
	if (!scope.entryId)
		throw new FigureNarrowingError(`${figure} needs an entryId narrowing`);
	const user = await db.user.findUnique({
		where: { id: scope.userId },
		select: { homeCurrency: true },
	});
	const home = user?.homeCurrency ?? "USD";
	const homeRate = await findExchangeRate(db, home, new Date());
	return entryRowFrom(
		scope.entryId,
		await loadActivityInputs(
			db,
			[rowKeyFromEntryId(scope.entryId)],
			scope.userId,
		),
		{
			userId: scope.userId,
			timeZone: undefined,
			rates: { home, homeRate: homeRate?.rate ?? null },
		},
	);
}

export const entryAmountFigure: FigureDefinition = {
	id: "entry.amount",
	scope: ["entryId"],
	compute: async (db, scope) =>
		entryAmountOf(await rowOf(db, scope, "entry.amount")),
};

export const entryShareFigure: FigureDefinition = {
	id: "entry.share",
	scope: ["entryId"],
	compute: async (db, scope) =>
		entryShareOf(await rowOf(db, scope, "entry.share")),
};

export const entryFigures: readonly FigureDefinition[] = [
	entryAmountFigure,
	entryShareFigure,
];
