import * as gap from "~/server/services/api-v1/gap-reads";
import * as settings from "~/server/services/api-v1/settings";
import { serve } from "../core/serve";
import { signedIn, v1 } from "../middleware";

const s = v1.settings;

export const settingsRouter = {
	aiStatus: s.aiStatus.handler(
		serve(({ context }) => gap.readAiStatus(signedIn(context))),
	),
	get: s.get.handler(
		serve(({ context }) => settings.readGeneralSettings(signedIn(context))),
	),
	update: s.update.handler(
		serve(({ context, input }) =>
			settings.patchGeneralSettings(signedIn(context), input),
		),
	),
	getPage: s.getPage.handler(
		serve(({ context, input }) =>
			settings.readPageSettings(signedIn(context), input.page),
		),
	),
	updatePage: s.updatePage.handler(
		serve(({ context, input }) =>
			settings.patchPageSettings(signedIn(context), input.page, input.settings),
		),
	),
	listCategoryPreferences: s.listCategoryPreferences.handler(
		serve(({ context, input }) =>
			settings.listCategoryPreferences(signedIn(context), input),
		),
	),
	setCategoryPreference: s.setCategoryPreference.handler(
		serve(({ context, input }) =>
			settings.setCategoryPreference(
				signedIn(context),
				input.categoryId,
				input.isFlexible,
			),
		),
	),
	deleteCategoryPreference: s.deleteCategoryPreference.handler(
		serve(({ context, input }) =>
			settings.deleteCategoryPreference(signedIn(context), input.categoryId),
		),
	),
	listFavoriteRates: s.listFavoriteRates.handler(
		serve(({ context, input }) =>
			settings.listFavorites(signedIn(context), input),
		),
	),
	addFavoriteRate: s.addFavoriteRate.handler(
		serve(({ context, input }) =>
			settings.addFavorite(signedIn(context), input.exchangeRateId),
		),
	),
	removeFavoriteRate: s.removeFavoriteRate.handler(
		serve(({ context, input }) =>
			settings.removeFavorite(signedIn(context), input.exchangeRateId),
		),
	),
	reorderFavoriteRates: s.reorderFavoriteRates.handler(
		serve(({ context, input }) =>
			settings.reorderFavorites(signedIn(context), input.exchangeRateIds),
		),
	),
};
