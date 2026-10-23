import { z } from "zod";
import { SUPPORTED_LOCALES } from "~/i18n/locales";
import {
	createTRPCRouter,
	protectedProcedure,
	publicProcedure,
} from "~/server/api/trpc";
import { resolveAiAccess } from "~/server/services/ai-access.service";
import {
	getGeneralSettings,
	updateGeneralSettings,
} from "~/server/services/general-settings.service";
import {
	getAppSettings,
	isInviteOnlyEnabled,
} from "~/server/services/settings";

export const settingsRouter = createTRPCRouter({
	getGeneral: protectedProcedure.query(async ({ ctx }) => {
		const [user, appSettings] = await Promise.all([
			getGeneralSettings(ctx.db, ctx.session.user.id),
			getAppSettings(),
		]);
		const { autoAcceptSplits: _autoAccept, ...general } = user;
		return {
			...general,
			monthlyIncome: Number(user.monthlyIncome),
			allowAllUsersToGenerateInvites:
				appSettings.allowAllUsersToGenerateInvites,
		};
	}),

	updateGeneral: protectedProcedure
		.input(
			z.object({
				// Optional like every field here: a write names only what changed,
				// so a late Undo of another field can never put an old currency back.
				homeCurrency: z
					.string()
					.length(3, "Currency must be 3 characters")
					.optional(),
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
				language: z.enum(SUPPORTED_LOCALES).optional(),
				// Checked against the runtime's zone list by the service.
				timeZone: z.string().min(1).max(64).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const updated = await updateGeneralSettings(
				ctx.db,
				ctx.session.user.id,
				input,
			);
			return {
				homeCurrency: updated.homeCurrency,
				defaultCurrency: updated.defaultCurrency,
				categoryClickBehavior: updated.categoryClickBehavior,
				currencySymbolStyle: updated.currencySymbolStyle,
				timeZone: updated.timeZone,
			};
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
