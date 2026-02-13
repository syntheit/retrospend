import { z } from "zod";
import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import {
	getAppSettings,
	isInviteOnlyEnabled,
} from "~/server/services/settings";

export const settingsRouter = createTRPCRouter({
	getGeneral: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;

		const user = await db.user.findUnique({
			where: { id: session.user.id },
			select: {
				homeCurrency: true,
				defaultCurrency: true,
				categoryClickBehavior: true,
				fontPreference: true,
				currencySymbolStyle: true,
				monthlyIncome: true,
				budgetMode: true,
				smartCurrencyFormatting: true,
			},
		});

		if (!user) {
			throw new Error("User not found");
		}

		const appSettings = await getAppSettings();

		return {
			homeCurrency: user.homeCurrency,
			defaultCurrency: user.defaultCurrency,
			categoryClickBehavior: user.categoryClickBehavior,
			fontPreference: user.fontPreference,
			currencySymbolStyle: user.currencySymbolStyle,
			monthlyIncome: user.monthlyIncome,
			budgetMode: user.budgetMode,
			smartCurrencyFormatting: user.smartCurrencyFormatting,
			allowAllUsersToGenerateInvites:
				appSettings.allowAllUsersToGenerateInvites,
		};
	}),

	updateGeneral: protectedProcedure
		.input(
			z.object({
				homeCurrency: z.string().length(3, "Currency must be 3 characters"),
				defaultCurrency: z
					.string()
					.length(3, "Currency must be 3 characters")
					.optional(),
				categoryClickBehavior: z.enum(["navigate", "toggle"]).optional(),
				fontPreference: z.enum(["sans", "mono"]).optional(),
				currencySymbolStyle: z.enum(["native", "standard"]).optional(),
				budgetMode: z.enum(["GLOBAL_LIMIT", "SUM_OF_CATEGORIES"]).optional(),
				monthlyIncome: z
					.number()
					.min(0, "Monthly income must be non-negative")
					.optional(),
				smartCurrencyFormatting: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { session, db } = ctx;

			return await db.user.update({
				where: { id: session.user.id },
				data: {
					homeCurrency: input.homeCurrency,
					...(input.categoryClickBehavior && {
						categoryClickBehavior: input.categoryClickBehavior,
					}),
					...(input.fontPreference && {
						fontPreference: input.fontPreference,
					}),
					...(input.currencySymbolStyle && {
						currencySymbolStyle: input.currencySymbolStyle,
					}),
					...(input.budgetMode && {
						budgetMode: input.budgetMode,
					}),
					...(input.defaultCurrency && {
						defaultCurrency: input.defaultCurrency,
					}),
					...(input.monthlyIncome !== undefined && {
						monthlyIncome: input.monthlyIncome,
					}),
					...(input.smartCurrencyFormatting !== undefined && {
						smartCurrencyFormatting: input.smartCurrencyFormatting,
					}),
				},
				select: {
					homeCurrency: true,
					defaultCurrency: true,
					categoryClickBehavior: true,
					currencySymbolStyle: true,
					budgetMode: true,
				},
			});
		}),

	getInviteOnlyEnabled: publicProcedure.query(async () => {
		const inviteOnlyEnabled = await isInviteOnlyEnabled();
		return {
			inviteOnlyEnabled,
		};
	}),
});
