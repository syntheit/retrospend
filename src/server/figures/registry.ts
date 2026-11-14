/**
 * Figures registry: one definition per number (IMPLEMENTATION §2.4).
 *
 * Every named number the product shows (`spent`, `owed.owedToYou`, `netWorth`,
 * ...) is registered here exactly once, under a stable id. Web, /api/v1, the
 * previews and the e2e display audit all read figures through this list, so
 * two screens can never compute the same number two ways.
 *
 * The generic core (definitions, passes, reading, diffing inputs) lives in
 * `@retrospend/domain/figures/registry`, shared with the device registry;
 * this file keeps the server's Prisma instantiation and the list.
 *
 * To add a figure: write its function in `src/server/services/figures/*`,
 * add its definition to `figures` at the bottom of this file, and give it a
 * test whose title is the plain string literal `"figure <id>"`, for example
 * `describe("figure owed.owedToYou", ...)` in any `*.test.ts` file under `src`.
 * registry.test.ts scans test sources for that literal and fails for any
 * registered id without one, so keep the title a literal, not a template.
 */

import {
	type FigureDefinition as CoreFigureDefinition,
	type FiguresRegistry as CoreFiguresRegistry,
	createFiguresRegistry,
} from "@retrospend/domain/figures/registry";
import { accountFigures } from "~/server/services/accounts/figures";
import { correctionFigures } from "~/server/services/corrections/figures";
import { budgetFigures } from "~/server/services/envelope/figures";
import { dollarTodayFigure } from "~/server/services/figures/dollar-today";
import { entryFigures } from "~/server/services/figures/entry";
import { recurringFigures } from "~/server/services/figures/recurring";
import { glanceFigures } from "~/server/services/figures/spend-pace";
import { spentFigure } from "~/server/services/figures/spent";
import { insightsFigures } from "~/server/services/insights/figures";
import {
	balancePersonFigure,
	owedToYouFigure,
	youOweFigure,
} from "~/server/services/payments/figures";
import { projectFigures } from "~/server/services/project/figures";
import type { Prisma } from "~prisma";

export {
	convertedIn,
	createFiguresRegistry,
	FigureError,
	type FigureNarrowing,
	FigureNarrowingError,
	FigurePass,
	type FigureReading,
	FigureRegistryError,
	type FigureScope,
	FigureUnavailable,
	type FigureValue,
	narrowScope,
	readFigure,
	readFiguresIn,
	type ScopeKey,
} from "@retrospend/domain/figures/registry";
export type { Money } from "@retrospend/domain/money-minor";

/**
 * What a figure reads through: always an open transaction with RLS set.
 * Plain reads go through readFigures (figures/read.ts), which opens a
 * userTransaction, so even `$queryRaw` runs under RLS; a preview passes its
 * own transaction, so figures see the mutation's uncommitted rows.
 */
export type FigureDb = Prisma.TransactionClient;

export type FigureDefinition<Db = FigureDb> = CoreFigureDefinition<Db>;
export type FiguresRegistry<Db = FigureDb> = CoreFiguresRegistry<Db>;

/** Every figure in the product. Track 2A and later tracks add their definitions here. */
export const figures = createFiguresRegistry<FigureDb>([
	spentFigure,
	balancePersonFigure,
	owedToYouFigure,
	youOweFigure,
	...projectFigures,
	...accountFigures,
	...budgetFigures,
	...glanceFigures,
	...entryFigures,
	...recurringFigures,
	...correctionFigures,
	dollarTodayFigure,
	...insightsFigures,
]);
