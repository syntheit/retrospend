/**
 * importReview: the Review step's read model (import.html step 3). Every row
 * of the file with its amount, its home value at the rate the import will
 * save (bookImportRow, so the screen and the saved row agree), whether it is
 * already in Activity, the kind it is proposed as and its category; plus the
 * file's counts, which always add up: rows in the file = readable rows +
 * rows that cannot be read.
 */
import { TRPCError } from "@trpc/server";
import type { Money } from "~/server/figures/registry";
import type { Prisma, PrismaClient } from "~prisma";
import { toMinor } from "../envelope/units";
import { loadRateContext } from "../rate-types";
import { bookImportRow, type ImportRate } from "./book";
import { matchFile } from "./match";
import { prepareRows } from "./prepare";
import { cachedRates } from "./rate-cache";
import {
	categoryKindFor,
	type ImportKind,
	noRateCount,
	storedRows,
	unreadableCount,
} from "./rows";

type Db = PrismaClient | Prisma.TransactionClient;

/** Titles looked up for suggestions; a statement rarely has more distinct ones. */
const SUGGEST_TITLES = 300;

export interface ImportReviewRow {
	readonly index: number;
	/** YYYY-MM-DD. */
	readonly date: string;
	readonly title: string;
	readonly amount: Money;
	/** The home value the import saves; null when there is no rate yet. */
	readonly home: Money | null;
	/** 1 unit of the row's currency in home, and the rate type, for the rate tip. */
	readonly rate: { unit: Money; value: Money; type: string | null } | null;
	/** The category name the file has ("" when none). */
	readonly fileCategory: string;
	readonly categoryId: string | null;
	readonly kind: ImportKind;
	/** Exact: this row is already in Activity; the import skips it. */
	readonly duplicate: boolean;
	/** Likely: an Activity row with the same amount within 3 days; kept unless you skip it. */
	readonly possible: { readonly title: string; readonly date: string } | null;
	/** No rate at all for its currency: it cannot be saved and is skipped. */
	readonly noRate: boolean;
}

export interface UnmatchedCategory {
	readonly name: string;
	readonly rows: number;
	/** Your category most used for these titles before, or null. */
	readonly suggestionId: string | null;
}

export interface ImportReview {
	readonly jobId: string;
	readonly fileName: string;
	readonly type: "CSV" | "BANK_STATEMENT";
	readonly homeCurrency: string;
	readonly rows: readonly ImportReviewRow[];
	readonly counts: {
		/** Every row the file has: readable + unreadable. */
		readonly fileRows: number;
		readonly unreadable: number;
		readonly duplicates: number;
		readonly noRate: number;
	};
	readonly unmatched: readonly UnmatchedCategory[];
	/** The currencies the file's rows are in, for the Currency chip. */
	readonly currencies: readonly string[];
	/** The override in effect, or null for the file's own. */
	readonly currency: string | null;
	readonly warnings: readonly string[];
}

export async function loadReviewableJob(db: Db, userId: string, jobId: string) {
	const job = await db.importJob.findFirst({ where: { id: jobId, userId } });
	if (!job) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Import not found" });
	}
	if (job.status !== "READY_FOR_REVIEW" && job.status !== "REVIEWING") {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message:
				job.status === "COMPLETED"
					? "This file was already imported"
					: "This file is not ready to review",
		});
	}
	return job;
}

const moneyOf = (amount: string | number, currency: string): Money => ({
	minor: toMinor(String(amount), currency),
	currency,
});

function rateView(rate: ImportRate | null, currency: string, home: string) {
	if (!rate?.home || currency === home) return null;
	return {
		unit: moneyOf(1, currency),
		value: moneyOf(rate.home.homeRate, home),
		type: rate.home.rateType,
	};
}

/** For each unmatched name, the category its titles were filed under most often. */
async function suggestions(
	db: Db,
	userId: string,
	groups: Map<string, string[]>,
	allowed: ReadonlySet<string>,
): Promise<Map<string, string>> {
	const titles = [...new Set([...groups.values()].flat())].slice(
		0,
		SUGGEST_TITLES,
	);
	const out = new Map<string, string>();
	if (titles.length === 0) return out;
	const used = await db.expense.groupBy({
		by: ["title", "categoryId"],
		where: {
			userId,
			categoryId: { not: null },
			OR: titles.map((t) => ({ title: { equals: t, mode: "insensitive" } })),
		},
		_count: { _all: true },
	});
	for (const [name, names] of groups) {
		const wanted = new Set(names.map((n) => n.toLowerCase()));
		const score = new Map<string, number>();
		for (const u of used) {
			if (!u.categoryId || !allowed.has(u.categoryId)) continue;
			if (!wanted.has(u.title.toLowerCase())) continue;
			score.set(u.categoryId, (score.get(u.categoryId) ?? 0) + u._count._all);
		}
		const best = [...score].sort((a, b) => b[1] - a[1])[0];
		if (best) out.set(name, best[0]);
	}
	return out;
}

export async function importReview(
	db: Db,
	userId: string,
	jobId: string,
	options: { currency?: string | null; timeZone?: string } = {},
): Promise<ImportReview> {
	const job = await loadReviewableJob(db, userId, jobId);
	const stored = storedRows(job.transactions);
	const { rows, badDates } = prepareRows(stored, options);
	const rates = cachedRates(db);
	const [ctx, categories, matches] = await Promise.all([
		loadRateContext(rates, userId),
		db.category.findMany({
			where: { userId },
			select: { id: true, name: true, kind: true },
		}),
		matchFile(db, userId, rows, (r) => r.proposed, options.timeZone),
	]);
	const home = ctx.homeCurrency;
	const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
	const byId = new Map(categories.map((c) => [c.id, c]));

	const out: ImportReviewRow[] = [];
	const unmatched = new Map<string, string[]>();
	for (const row of rows) {
		const kind = row.proposed;
		const want = categoryKindFor(kind);
		const fileCategory = row.stored.category?.trim() ?? "";
		const given = row.stored.categoryId
			? byId.get(row.stored.categoryId)
			: undefined;
		const named =
			given ??
			(fileCategory ? byName.get(fileCategory.toLowerCase()) : undefined);
		const categoryId = named && named.kind === want ? named.id : null;
		const match = matches.get(row.index);
		const duplicate = match?.exact != null;
		const rate = await bookImportRow(rates, ctx, row.rate);
		const currency = row.rate.currency;
		if (!categoryId && fileCategory && !duplicate) {
			const titles = unmatched.get(fileCategory) ?? [];
			titles.push(row.title);
			unmatched.set(fileCategory, titles);
		}
		out.push({
			index: row.index,
			date: row.day,
			title: row.title,
			amount: moneyOf(row.rate.amount, currency),
			home: rate?.home
				? moneyOf(rate.home.homeAmount, rate.home.homeCurrency)
				: null,
			rate: rateView(rate, currency, home),
			fileCategory,
			categoryId,
			kind,
			duplicate,
			possible:
				!duplicate && match?.likely
					? { title: match.likely.title, date: match.likely.day }
					: null,
			noRate: rate === null,
		});
	}

	const expenseIds = new Set(
		categories.filter((c) => c.kind === "EXPENSE").map((c) => c.id),
	);
	const suggested = await suggestions(db, userId, unmatched, expenseIds);
	const unreadable = unreadableCount(job.warnings) + badDates;
	return {
		jobId: job.id,
		fileName: job.fileName,
		type: job.type,
		homeCurrency: home,
		rows: out,
		counts: {
			fileRows:
				stored.length +
				unreadableCount(job.warnings) +
				noRateCount(job.warnings),
			unreadable,
			duplicates: out.filter((r) => r.duplicate).length,
			noRate:
				out.filter((r) => r.noRate && !r.duplicate).length +
				noRateCount(job.warnings),
		},
		unmatched: [...unmatched].map(([name, titles]) => ({
			name,
			rows: titles.length,
			suggestionId: suggested.get(name) ?? null,
		})),
		currencies: [...new Set(stored.map((r) => r.currency.toUpperCase()))],
		currency: options.currency?.toUpperCase() ?? null,
		warnings: Array.isArray(job.warnings)
			? job.warnings.filter((w): w is string => typeof w === "string")
			: [],
	};
}
