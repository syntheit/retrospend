/**
 * importReview: the Review step's read model (import.html step 3). Every row
 * of the file with its amount, its home value at the rate the import will
 * save (bookImportRow, so the screen and the saved row agree), whether it is
 * already in Activity, the kind it is proposed as and its category; plus the
 * file's counts, which always add up: rows in the file = readable rows +
 * rows that cannot be read.
 */
import { TRPCError } from "@trpc/server";
import { categoryNameKey } from "~/lib/category-name-key";
import type { Keyring } from "~/server/crypto/field-crypto";
import type { Money } from "~/server/figures/registry";
import type { Prisma, PrismaClient } from "~prisma";
import { toMinor } from "../envelope/units";
import { loadRateContext } from "../rate-types";
import {
	APP_LAYER_WINDOW,
	pgLower,
	searchesInApp,
} from "../search-fold";
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
	readonly rate: {
		unit: Money;
		value: Money;
		/** The rate unrounded: home per `unit`. */
		rate: string;
		type: string | null;
	} | null;
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
		rate: rate.home.homeRate,
		type: rate.home.rateType,
	};
}

/**
 * How many of the newest categorized expenses the app-layer path reads for
 * suggestions. Titles older than that are not counted on that path; the SQL
 * path has no such limit. One query per review.
 */
export const SUGGESTION_WINDOW = APP_LAYER_WINDOW;

/** The value as an ILIKE pattern that matches only itself. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");

type Used = { title: string; categoryId: string | null; count: number };

/**
 * The SQL path: Postgres finds the rows whose title equals one of `titles`,
 * ignoring case. Prisma's insensitive `equals` is `ILIKE`, so each title is
 * escaped first and `%`, `_` and backslash match only themselves, as on the
 * app path.
 */
async function usedInSql(
	db: Db,
	userId: string,
	titles: readonly string[],
): Promise<Used[]> {
	const used = await db.expense.groupBy({
		by: ["title", "categoryId"],
		where: {
			userId,
			categoryId: { not: null },
			OR: titles.map((t) => ({
				title: { equals: escapeLike(t), mode: "insensitive" },
			})),
		},
		_count: { _all: true },
	});
	return used.map((u) => ({
		title: u.title,
		categoryId: u.categoryId,
		count: u._count._all,
	}));
}

/**
 * The app-layer path, for titles SQL cannot read: read the newest
 * categorized expenses (the client opens each title), and keep those equal to one of
 * `titles` after `pgLower`, the fold ILIKE applies to both sides, with no
 * pattern characters and no trimming. Counts are per (title, category), as
 * the SQL grouped them.
 */
async function usedInApp(
	db: Db,
	userId: string,
	titles: readonly string[],
	window: number,
): Promise<Used[]> {
	const wanted = new Set(titles.map(pgLower));
	const rows = await db.expense.findMany({
		where: { userId, categoryId: { not: null } },
		orderBy: [{ date: "desc" }, { id: "desc" }],
		take: window,
		select: { id: true, title: true, categoryId: true },
	});
	const counts = new Map<string, Used>();
	for (const r of rows) {
		const { title } = r;
		if (!wanted.has(pgLower(title))) continue;
		const key = `${r.categoryId}\u0000${title}`;
		const seen = counts.get(key);
		if (seen) seen.count++;
		else counts.set(key, { title, categoryId: r.categoryId, count: 1 });
	}
	return [...counts.values()];
}

/** For each unmatched name, the category its titles were filed under most often. */
async function suggestions(
	db: Db,
	userId: string,
	groups: Map<string, string[]>,
	allowed: ReadonlySet<string>,
	options: { keyring?: Keyring; window?: number } = {},
): Promise<Map<string, string>> {
	const titles = [...new Set([...groups.values()].flat())].slice(
		0,
		SUGGEST_TITLES,
	);
	const out = new Map<string, string>();
	if (titles.length === 0) return out;
	const { keyring, window } = options;
	const used = searchesInApp(keyring)
		? await usedInApp(db, userId, titles, window ?? SUGGESTION_WINDOW)
		: await usedInSql(db, userId, titles);
	for (const [name, names] of groups) {
		const wanted = new Set(names.map((n) => n.toLowerCase()));
		const score = new Map<string, number>();
		for (const u of used) {
			if (!u.categoryId || !allowed.has(u.categoryId)) continue;
			if (!wanted.has(u.title.toLowerCase())) continue;
			score.set(u.categoryId, (score.get(u.categoryId) ?? 0) + u.count);
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
	options: {
		currency?: string | null;
		timeZone?: string;
		/** Passing one picks the app-layer paths, which SQL cannot replace once titles are sealed. */
		keyring?: Keyring;
		/** App-layer suggestions only: rows read, for tests. */
		suggestionWindow?: number;
	} = {},
): Promise<ImportReview> {
	const job = await loadReviewableJob(db, userId, jobId);
	const stored = storedRows(job.transactions);
	const { rows, badDates, badText } = prepareRows(stored, options);
	const rates = cachedRates(db);
	const [ctx, categories, matches] = await Promise.all([
		loadRateContext(rates, userId),
		db.category.findMany({
			where: { userId },
			select: { id: true, name: true, kind: true },
		}),
		matchFile(
			db,
			userId,
			rows,
			(r) => r.proposed,
			options.timeZone,
		),
	]);
	const home = ctx.homeCurrency;
	const byName = new Map(categories.map((c) => [categoryNameKey(c.name), c]));
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
			(fileCategory ? byName.get(categoryNameKey(fileCategory)) : undefined);
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
	const suggested = await suggestions(db, userId, unmatched, expenseIds, {
		keyring: options.keyring,
		window: options.suggestionWindow,
	});
	const unreadable = unreadableCount(job.warnings) + badDates + badText;
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
