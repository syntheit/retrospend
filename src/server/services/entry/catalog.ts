/**
 * What the Add family sheets read before anything is typed (one call):
 * the home currency, categories of both kinds with their tone, the recent
 * expense categories for the recents line, and the places money can go
 * (open accounts with their balance, the default account per currency).
 * Amounts are Money in minor units; the client only formats them.
 */
import { categoryTone } from "~/lib/category-tone";
import type { Money } from "~/server/figures/registry";
import type { PrismaClient } from "~prisma";
import { defaultAccounts } from "../accounts/defaults";
import { inBudget, isLiability, worthOf } from "../accounts/places";
import { dec, toMinor } from "../envelope/units";
import { ensureIncomeCategories } from "../money-in.service";

/** How far back "recent" reaches, and how many the recents line can show. */
const RECENT_DAYS = 45;
const RECENT_COUNT = 5;

export interface EntryCategory {
	readonly id: string;
	readonly name: string;
	readonly icon: string | null;
	/** --category-n token number. */
	readonly tone: number;
	readonly kind: "EXPENSE" | "INCOME";
	/** Expenses in it start excluded from spending. */
	readonly excludeByDefault: boolean;
}

export interface EntryPlace {
	readonly id: string;
	readonly name: string;
	readonly type: string;
	readonly currency: string;
	/** What it is worth to you: a debt is negative. */
	readonly balance: Money;
	/** "Part of my budget" (MONEY-MOVES §2.1), its default when unset. */
	readonly inBudget: boolean;
	readonly liability: boolean;
}

export interface EntryCatalog {
	readonly homeCurrency: string;
	readonly categories: readonly EntryCategory[];
	readonly recentCategoryIds: readonly string[];
	readonly places: readonly EntryPlace[];
	/** Default account id per currency (Settings), only a prefill (N75). */
	readonly defaultAccounts: Readonly<Record<string, string>>;
}

/** Your expense categories used most in the last RECENT_DAYS, most used first. */
async function recentCategoryIds(db: PrismaClient, userId: string) {
	const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
	const rows = await db.expense.groupBy({
		by: ["categoryId"],
		where: {
			userId,
			direction: "OUT",
			isAmortizedChild: false,
			date: { gte: since },
			categoryId: { not: null },
		},
		_count: { _all: true },
		orderBy: { _count: { categoryId: "desc" } },
		take: RECENT_COUNT,
	});
	return rows.flatMap((r) => (r.categoryId ? [r.categoryId] : []));
}

export async function entryCatalog(
	db: PrismaClient,
	userId: string,
): Promise<EntryCatalog> {
	// Income categories exist from the first Add income on (same as income.add).
	await ensureIncomeCategories(db, userId);
	const [user, categories, recent, accounts, defaults] = await Promise.all([
		db.user.findUniqueOrThrow({
			where: { id: userId },
			select: { homeCurrency: true },
		}),
		db.category.findMany({
			where: { userId },
			orderBy: [{ expenses: { _count: "desc" } }, { name: "asc" }],
			select: {
				id: true,
				name: true,
				icon: true,
				color: true,
				kind: true,
				excludeByDefault: true,
			},
		}),
		recentCategoryIds(db, userId),
		db.assetAccount.findMany({
			where: {
				userId,
				closedAt: null,
				type: { notIn: ["REAL_ESTATE", "VEHICLE"] },
			},
			orderBy: [{ type: "asc" }, { name: "asc" }],
			select: {
				id: true,
				name: true,
				type: true,
				currency: true,
				balance: true,
				inBudget: true,
			},
		}),
		defaultAccounts(db, userId),
	]);
	const home = user.homeCurrency;
	return {
		homeCurrency: home,
		categories: categories.map(({ color, ...c }) => ({
			...c,
			tone: categoryTone(color),
		})),
		recentCategoryIds: recent,
		places: accounts.map((a) => ({
			id: a.id,
			name: a.name,
			type: a.type,
			currency: a.currency,
			balance: {
				minor: toMinor(worthOf(a.type, dec(a.balance.toString())), a.currency),
				currency: a.currency,
			},
			inBudget: inBudget(a, home),
			liability: isLiability(a.type),
		})),
		defaultAccounts: defaults,
	};
}
