import { TRPCError } from "@trpc/server";
import type { db as globalDb } from "~/server/db";
import { supportedTimeZone } from "~/server/services/user-time-zone";
import type {
	AiMode,
	CategoryClickBehavior,
	CurrencySymbolStyle,
	DefaultExpenseDateBehavior,
	NumberFormat,
	Prisma,
} from "~prisma";

type AppDb = typeof globalDb;

/**
 * A user's general settings: one read and one partial write, shared by the
 * tRPC settings router and /api/v1/settings. Callers pass a user-scoped
 * client, so RLS holds.
 */
export const GENERAL_SETTINGS_SELECT = {
	homeCurrency: true,
	defaultCurrency: true,
	categoryClickBehavior: true,
	currencySymbolStyle: true,
	numberFormat: true,
	monthlyIncome: true,
	monthlyIncomeCurrency: true,
	smartCurrencyFormatting: true,
	defaultPrivacyMode: true,
	autoAcceptSplits: true,
	fiscalMonthStartDay: true,
	defaultExpenseDateBehavior: true,
	aiMode: true,
	language: true,
	timeZone: true,
} as const satisfies Prisma.UserSelect;

export type GeneralSettingsRow = Prisma.UserGetPayload<{
	select: typeof GENERAL_SETTINGS_SELECT;
}>;

/** Fields a caller may change; undefined leaves a field as it is. */
export interface GeneralSettingsChanges {
	homeCurrency?: string;
	defaultCurrency?: string;
	categoryClickBehavior?: CategoryClickBehavior;
	currencySymbolStyle?: CurrencySymbolStyle;
	/** The account's group and decimal marks; null follows the app language. */
	numberFormat?: NumberFormat | null;
	/** A decimal string or number in monthlyIncomeCurrency; null clears it. */
	monthlyIncome?: string | number | null;
	monthlyIncomeCurrency?: string;
	smartCurrencyFormatting?: boolean;
	defaultPrivacyMode?: boolean;
	autoAcceptSplits?: boolean;
	fiscalMonthStartDay?: number;
	defaultExpenseDateBehavior?: DefaultExpenseDateBehavior;
	aiMode?: AiMode;
	language?: string;
	/** An IANA zone; stored in its canonical spelling (supportedTimeZone). */
	timeZone?: string;
}

export async function getGeneralSettings(
	db: AppDb,
	userId: string,
): Promise<GeneralSettingsRow> {
	const row = await db.user.findUnique({
		where: { id: userId },
		select: GENERAL_SETTINGS_SELECT,
	});
	if (!row)
		throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
	return row;
}

export async function updateGeneralSettings(
	db: AppDb,
	userId: string,
	changes: GeneralSettingsChanges,
): Promise<GeneralSettingsRow> {
	const data = Object.fromEntries(
		Object.entries(changes).filter(([, v]) => v !== undefined),
	) as Prisma.UserUpdateInput;
	if (changes.timeZone !== undefined) {
		const zone = supportedTimeZone(changes.timeZone);
		if (!zone) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Pick a time zone from the list",
			});
		}
		data.timeZone = zone;
	}
	return db.user.update({
		where: { id: userId },
		data,
		select: GENERAL_SETTINGS_SELECT,
	});
}
