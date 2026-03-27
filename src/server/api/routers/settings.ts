import { z } from "zod";
import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import { resolveAiAccess } from "~/server/services/ai-access.service";
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
				currencySymbolStyle: true,
				monthlyIncome: true,
				monthlyIncomeCurrency: true,
				smartCurrencyFormatting: true,
				defaultPrivacyMode: true,
				fiscalMonthStartDay: true,
				defaultExpenseDateBehavior: true,
				aiMode: true,
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
			currencySymbolStyle: user.currencySymbolStyle,
			monthlyIncome: Number(user.monthlyIncome),
			monthlyIncomeCurrency: user.monthlyIncomeCurrency,
			smartCurrencyFormatting: user.smartCurrencyFormatting,
			defaultPrivacyMode: user.defaultPrivacyMode,
			fiscalMonthStartDay: user.fiscalMonthStartDay,
			defaultExpenseDateBehavior: user.defaultExpenseDateBehavior,
			aiMode: user.aiMode,
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

				currencySymbolStyle: z.enum(["native", "standard"]).optional(),
				monthlyIncome: z
					.number()
					.min(0, "Monthly income must be non-negative")
					.optional(),
				monthlyIncomeCurrency: z.string().length(3).optional(),
				smartCurrencyFormatting: z.boolean().optional(),
				defaultPrivacyMode: z.boolean().optional(),
				fiscalMonthStartDay: z.number().int().min(1).max(28).optional(),
				defaultExpenseDateBehavior: z.enum(["TODAY", "LAST_USED"]).optional(),
				aiMode: z.enum(["LOCAL", "EXTERNAL"]).optional(),
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

					...(input.currencySymbolStyle && {
						currencySymbolStyle: input.currencySymbolStyle,
					}),
					...(input.defaultCurrency && {
						defaultCurrency: input.defaultCurrency,
					}),
					...(input.monthlyIncome !== undefined && {
						monthlyIncome: input.monthlyIncome,
					}),
					...(input.monthlyIncomeCurrency !== undefined && {
						monthlyIncomeCurrency: input.monthlyIncomeCurrency,
					}),
					...(input.smartCurrencyFormatting !== undefined && {
						smartCurrencyFormatting: input.smartCurrencyFormatting,
					}),
					...(input.defaultPrivacyMode !== undefined && {
						defaultPrivacyMode: input.defaultPrivacyMode,
					}),
					...(input.fiscalMonthStartDay !== undefined && {
						fiscalMonthStartDay: input.fiscalMonthStartDay,
					}),
					...(input.defaultExpenseDateBehavior !== undefined && {
						defaultExpenseDateBehavior: input.defaultExpenseDateBehavior,
					}),
					...(input.aiMode !== undefined && {
						aiMode: input.aiMode,
					}),
				},
				select: {
					homeCurrency: true,
					defaultCurrency: true,
					categoryClickBehavior: true,
					currencySymbolStyle: true,
				},
			});
		}),

	getAiStatus: protectedProcedure.query(async ({ ctx }) => {
		const { session, db } = ctx;
		const user = await db.user.findUnique({
			where: { id: session.user.id },
			select: { aiMode: true },
		});
		const currentMode = user?.aiMode ?? "LOCAL";
		const access = await resolveAiAccess(db, session.user.id, "EXTERNAL");

		return {
			currentMode,
			externalAvailable: access.allowed,
			externalDeniedReason: access.reason ?? null,
			quotaRemaining: access.quotaRemaining,
		};
	}),

	getInviteOnlyEnabled: publicProcedure.query(async () => {
		const inviteOnlyEnabled = await isInviteOnlyEnabled();
		return {
			inviteOnlyEnabled,
		};
	}),
});
