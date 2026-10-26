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
 */
import { FigureNarrowingError } from "~/server/figures/narrowing";
import { findExchangeRate } from "~/server/exchange-rates";
import type {
	FigureDb,
	FigureDefinition,
	FigureScope,
} from "~/server/figures/registry";
import { shapeRows } from "~/server/services/expense-list/rows";
import type { RowKey } from "~/server/services/expense-list/query";
import type { ActivityRowDTO } from "~/server/services/expense-list/types";

const SHARED = "shared:";
const PAYMENT = "payment:";

function keyOf(entryId: string): RowKey {
	const date = new Date(0);
	if (entryId.startsWith(SHARED))
		return { src: "s", id: entryId.slice(SHARED.length), date };
	if (entryId.startsWith(PAYMENT))
		return { src: "g", id: entryId.slice(PAYMENT.length), date };
	return { src: "p", id: entryId, date };
}

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
	const [row] = await shapeRows(db, [keyOf(scope.entryId)], {
		userId: scope.userId,
		timeZone: undefined,
		rates: { home, homeRate: homeRate?.rate ?? null },
	});
	return row ?? null;
}

export const entryAmountFigure: FigureDefinition = {
	id: "entry.amount",
	scope: ["entryId"],
	compute: async (db, scope) => {
		const row = await rowOf(db, scope, "entry.amount");
		return row ? [row.amount] : [];
	},
};

export const entryShareFigure: FigureDefinition = {
	id: "entry.share",
	scope: ["entryId"],
	compute: async (db, scope) => {
		const row = await rowOf(db, scope, "entry.share");
		return row?.share ? [row.share] : [];
	},
};

export const entryFigures: readonly FigureDefinition[] = [
	entryAmountFigure,
	entryShareFigure,
];
