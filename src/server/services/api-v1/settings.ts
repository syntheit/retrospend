import {
	type CursorQuery,
	type GeneralSettings,
	type generalSettingsPatchSchema,
	LANGUAGES,
	type PageKey,
	type pageSettingsInputSchema,
} from "@retrospend/api-contract";
import { fromMinor } from "@retrospend/domain/money-minor";
import { TRPCError } from "@trpc/server";
import * as z from "zod";
import {
	type GeneralSettingsChanges,
	type GeneralSettingsRow,
	getGeneralSettings,
	updateGeneralSettings,
} from "~/server/services/general-settings.service";
import {
	addFavoriteRate,
	type FavoriteRate,
	listFavoriteRates,
	removeFavoriteRate,
	reorderFavoriteRates,
} from "~/server/services/rate-favorites.service";
import {
	DEFAULT_PAGE_SETTINGS,
	deleteAnalyticsCategoryPreference,
	ensureAnalyticsCategoryPreferences,
	getPageSettings,
	setAnalyticsCategoryPreference,
	updatePageSettings,
} from "~/server/services/user-settings";
import type { Page } from "~prisma";
import { type Caller, moneyOf } from "./caller";
import { decodeCursor, toPage } from "./cursor";
import { toExchangeRate } from "./currencies";

/** v1 adapters for /settings: contract shapes in and out, services do the work. */

function toGeneral(row: GeneralSettingsRow): GeneralSettings {
	const language = (LANGUAGES as readonly string[]).includes(row.language)
		? (row.language as GeneralSettings["language"])
		: "en";
	const { monthlyIncome, monthlyIncomeCurrency, ...rest } = row;
	return {
		...rest,
		language,
		monthlyIncome:
			monthlyIncome === null
				? null
				: moneyOf(monthlyIncome, monthlyIncomeCurrency),
	};
}

export async function readGeneralSettings(caller: Caller) {
	return toGeneral(
		await getGeneralSettings(caller.db, caller.principal.userId),
	);
}

/** monthlyIncome is stored as Decimal(10, 2): more precision would be cut. */
const INCOME_MAX_DIGITS = 2;

export async function patchGeneralSettings(
	caller: Caller,
	patch: z.infer<typeof generalSettingsPatchSchema>,
) {
	const { monthlyIncome, ...rest } = patch;
	const changes: GeneralSettingsChanges = { ...rest };
	if (monthlyIncome === null) changes.monthlyIncome = null;
	if (monthlyIncome) {
		const text = fromMinor(monthlyIncome);
		const decimals = text.split(".")[1]?.replace(/0+$/, "") ?? "";
		if (decimals.length > INCOME_MAX_DIGITS) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: `Monthly income keeps at most ${INCOME_MAX_DIGITS} decimal places`,
			});
		}
		changes.monthlyIncome = text;
		changes.monthlyIncomeCurrency = monthlyIncome.currency;
	}
	return toGeneral(
		await updateGeneralSettings(caller.db, caller.principal.userId, changes),
	);
}

const toPageEnum = (key: PageKey) =>
	key.toUpperCase().replace("-", "_") as Page;

export async function readPageSettings(caller: Caller, page: PageKey) {
	const settings = await getPageSettings(
		caller.db,
		caller.principal.userId,
		toPageEnum(page),
	);
	return { page, settings };
}

export async function patchPageSettings(
	caller: Caller,
	page: PageKey,
	changes: z.infer<typeof pageSettingsInputSchema>,
) {
	const pageEnum = toPageEnum(page);
	// Each page's defaults list every field it stores.
	const own = Object.keys(DEFAULT_PAGE_SETTINGS[pageEnum]);
	const foreign = Object.keys(changes).filter((k) => !own.includes(k));
	if (foreign.length > 0) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Not settings of the ${page} page: ${foreign.join(", ")}`,
		});
	}
	const settings = await updatePageSettings(
		caller.db,
		caller.principal.userId,
		pageEnum,
		changes as Parameters<typeof updatePageSettings>[3],
	);
	return { page, settings };
}

const categoryCursor = z.object({ id: z.string() });

/** Seeds defaults the first time (as the web does), then pages by category id. */
export async function listCategoryPreferences(caller: Caller, q: CursorQuery) {
	const after = decodeCursor(q.cursor, categoryCursor);
	const all = await ensureAnalyticsCategoryPreferences(
		caller.db,
		caller.principal.userId,
	);
	const rows = all
		.filter((p) => !after || p.categoryId > after.id)
		.sort((a, b) => (a.categoryId < b.categoryId ? -1 : 1))
		.slice(0, q.limit + 1);
	return toPage(
		rows,
		q.limit,
		(p) => ({ id: p.categoryId }),
		(p) => ({
			categoryId: p.categoryId,
			categoryName: p.category.name,
			isFlexible: p.isFlexible,
		}),
	);
}

export async function setCategoryPreference(
	caller: Caller,
	categoryId: string,
	isFlexible: boolean,
) {
	await setAnalyticsCategoryPreference(
		caller.db,
		caller.principal.userId,
		categoryId,
		isFlexible,
	);
	const all = await ensureAnalyticsCategoryPreferences(
		caller.db,
		caller.principal.userId,
	);
	const pref = all.find((p) => p.categoryId === categoryId);
	if (!pref)
		throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });
	return {
		categoryId,
		categoryName: pref.category.name,
		isFlexible: pref.isFlexible,
	};
}

export async function deleteCategoryPreference(
	caller: Caller,
	categoryId: string,
) {
	await deleteAnalyticsCategoryPreference(
		caller.db,
		caller.principal.userId,
		categoryId,
	);
	return { ok: true as const };
}

function toFavorite(f: FavoriteRate) {
	return {
		exchangeRateId: f.exchangeRateId,
		order: f.order,
		rate: toExchangeRate(f.exchangeRate),
	};
}

const favoriteCursor = z.object({ order: z.int() });

export async function listFavorites(caller: Caller, q: CursorQuery) {
	const after = decodeCursor(q.cursor, favoriteCursor);
	const rows = await listFavoriteRates(caller.db, caller.principal.userId, {
		afterOrder: after?.order,
		take: q.limit + 1,
	});
	return toPage(rows, q.limit, (f) => ({ order: f.order }), toFavorite);
}

export async function addFavorite(caller: Caller, exchangeRateId: string) {
	return toFavorite(
		await addFavoriteRate(caller.db, caller.principal.userId, exchangeRateId),
	);
}

export async function removeFavorite(caller: Caller, exchangeRateId: string) {
	await removeFavoriteRate(caller.db, caller.principal.userId, exchangeRateId);
	return { ok: true as const };
}

export async function reorderFavorites(caller: Caller, ids: string[]) {
	await reorderFavoriteRates(caller.db, caller.principal.userId, ids);
	return { ok: true as const };
}
