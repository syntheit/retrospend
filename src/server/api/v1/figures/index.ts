import { MAX_FIGURE_IDS, parseFigureIds } from "@retrospend/api-contract";
import { readFigures } from "~/server/figures/read";
import {
	FigureNarrowingError,
	FigureRegistryError,
} from "~/server/figures/registry";
import * as gap from "~/server/services/api-v1/gap-reads";
import { readGlance } from "~/server/services/api-v1/home";
import * as insights from "~/server/services/api-v1/insights";
import { serve } from "../core/serve";
import { problem } from "../errors";
import { signedIn, v1 } from "../middleware";

export const figuresRouter = {
	firstDay: v1.figures.firstDay.handler(
		serve(({ context }) => gap.readFirstDay(signedIn(context))),
	),
	glance: v1.figures.glance.handler(
		serve(({ context }) => readGlance(signedIn(context))),
	),
	insightsSummary: v1.figures.insightsSummary.handler(
		serve(({ context, input }) =>
			insights.readInsightsSummary(signedIn(context), input),
		),
	),
	insightsMonths: v1.figures.insightsMonths.handler(
		serve(({ context, input }) =>
			insights.readInsightsMonths(signedIn(context), input),
		),
	),
	insightsYtd: v1.figures.insightsYtd.handler(
		serve(({ context, input }) =>
			insights.readInsightsYtd(signedIn(context), input),
		),
	),
	insightsCashflow: v1.figures.insightsCashflow.handler(
		serve(({ context, input }) =>
			insights.readInsightsCashflow(signedIn(context), input),
		),
	),
	read: v1.figures.read.handler(async ({ context, input }) => {
		const user = signedIn(context);
		const ids = parseFigureIds(input.ids);
		if (ids.length > MAX_FIGURE_IDS)
			throw problem("bad_request", `At most ${MAX_FIGURE_IDS} figure ids`);

		const {
			projectId,
			periodId,
			personId,
			accountId,
			categoryId,
			month,
			envelopeId,
			entryId,
			recurringId,
			transactionId,
		} = input;
		let readings: Awaited<ReturnType<typeof readFigures>>;
		try {
			readings = await readFigures(user.principal.userId, ids, {
				projectId,
				periodId,
				personId,
				accountId,
				categoryId,
				month,
				envelopeId,
				entryId,
				recurringId,
				transactionId,
			});
		} catch (error) {
			if (error instanceof FigureRegistryError)
				throw problem("not_found", error.message);
			if (error instanceof FigureNarrowingError)
				throw problem("bad_request", error.message);
			throw error;
		}
		return {
			figures: ids.map((id) => ({
				id,
				lines: readings.get(id)?.map((m) => ({ ...m })) ?? null,
			})),
		};
	}),
};
