import { z } from "zod";
import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import { isInviteOnlyEnabled } from "~/server/services/settings";
import {
	deleteAnalyticsCategoryPreference,
	ensureAnalyticsCategoryPreferences,
	getAnalyticsCategoryPreferenceMap,
	getPageSettings,
	updateAnalyticsCategoryPreference,
	updatePageSettings,
} from "~/server/services/user-settings";

export const settingsRouter = createTRPCRouter({
	getInviteOnlyEnabled: publicProcedure.query(async () => {
		const inviteOnlyEnabled = await isInviteOnlyEnabled();
		return {
			inviteOnlyEnabled,
		};
	}),

	getPageSettings: protectedProcedure
		.input(
			z.object({
				page: z.enum([
					"DASHBOARD",
					"BUDGET",
					"ANALYTICS",
					"WEALTH",
					"EXCHANGE_RATES",
					"SETTINGS",
					"TABLE",
					"ACCOUNT",
					"INVITE_CODES",
					"ADMIN",
					"EXPENSE",
				]),
			}),
		)
		.query(async ({ input, ctx }) => {
			return await getPageSettings(ctx.session.user.id, input.page);
		}),

	updatePageSettings: protectedProcedure
		.input(
			z.object({
				page: z.enum([
					"DASHBOARD",
					"BUDGET",
					"ANALYTICS",
					"WEALTH",
					"EXCHANGE_RATES",
					"SETTINGS",
					"TABLE",
					"ACCOUNT",
					"INVITE_CODES",
					"ADMIN",
					"EXPENSE",
				]),
				settings: z.any(), // Will be validated by the service
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return await updatePageSettings(
				ctx.session.user.id,
				input.page,
				input.settings,
			);
		}),

	getAnalyticsCategoryPreferences: protectedProcedure.query(async ({ ctx }) => {
		return await ensureAnalyticsCategoryPreferences(ctx.session.user.id);
	}),

	updateAnalyticsCategoryPreference: protectedProcedure
		.input(
			z.object({
				categoryId: z.string(),
				isFlexible: z.boolean(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return await updateAnalyticsCategoryPreference(
				ctx.session.user.id,
				input.categoryId,
				input.isFlexible,
			);
		}),

	deleteAnalyticsCategoryPreference: protectedProcedure
		.input(
			z.object({
				categoryId: z.string(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return await deleteAnalyticsCategoryPreference(
				ctx.session.user.id,
				input.categoryId,
			);
		}),

	getAnalyticsCategoryPreferenceMap: protectedProcedure.query(
		async ({ ctx }) => {
			return await getAnalyticsCategoryPreferenceMap(ctx.session.user.id);
		},
	),
});
