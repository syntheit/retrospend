/**
 * Which imported rows are already in Activity (queue-import-dupes.md), in
 * two tiers and never a silent fuzzy skip:
 *
 * - Exact: the same file row was imported before (its fingerprint, which
 *   survives later edits of the title or category), or the same day, amount,
 *   currency, kind and description. The review unchecks it and the commit
 *   skips it ("already in Activity").
 * - Likely: the same amount, currency and kind within 3 days, another
 *   description (a hand-typed "Coffee" vs the bank's "MERPAGO*CAFE"). It
 *   stays checked, flagged "Possibly already in Activity", one tap skips it.
 *
 * Matching is 1:1 against existing Activity rows (an existing row explains
 * at most one file row, closest date first) and never compares rows of the
 * file with each other: a statement can list two real, identical charges.
 * Descriptions are compared here, inside the import service, so a
 * client-side matcher can replace it when descriptions are end-to-end
 * encrypted.
 */
import { createHash } from "node:crypto";
import { currencyDecimals } from "@retrospend/domain/money";
import { dayKey, startOfDayIn, startOfNextDayIn } from "@retrospend/domain/time-zone";
import { Prisma, type PrismaClient } from "~prisma";
import type { PreparedRow } from "./prepare";
import { type ImportKind, kindOfColumns } from "./rows";

type Db = PrismaClient | Prisma.TransactionClient;

/** How far apart (in days) a likely match may be: bank posting delays. */
export const LIKELY_DAYS = 3;
const DAY_MS = 86_400_000;

/** Lowercase, no accents, words only: "MERPAGO*Café  Martínez" -> "merpago cafe martinez". */
export function normalizeTitle(title: string): string {
	return title
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

/**
 * An amount at its currency's minor units as text (half-even), so a file's
 * 63.4 and a stored 63.40000000 compare equal and an old row stored with
 * more decimals than its currency still compares.
 */
export function minorKey(amount: number | Prisma.Decimal, currency: string) {
	const decimals = currencyDecimals(currency);
	return new Prisma.Decimal(amount.toString())
		.toDecimalPlaces(decimals, Prisma.Decimal.ROUND_HALF_EVEN)
		.toFixed(decimals);
}

/** The file row as the fingerprint sees it. */
export interface MatchRow {
	readonly index: number;
	/** YYYY-MM-DD. */
	readonly day: string;
	readonly currency: string;
	/** The amount as minorKey text, so crypto amounts compare exactly. */
	readonly minor: string;
	readonly kind: ImportKind;
	readonly title: string;
	readonly fingerprint: string;
}

export interface ExistingRow {
	readonly id: string;
	readonly title: string;
	readonly day: string;
	readonly currency: string;
	readonly minor: string;
	readonly kind: ImportKind;
	readonly fingerprint: string | null;
}

export interface Match {
	readonly exact: ExistingRow | null;
	readonly likely: ExistingRow | null;
}

/** The imported row's identity: its day, currency, amount, proposed kind and description in the file. */
export function fileFingerprint(row: PreparedRow): string {
	const key = [
		"v1",
		row.day,
		row.rate.currency,
		minorKey(row.rate.amount, row.rate.currency),
		row.proposed,
		normalizeTitle(row.title),
	].join("|");
	return createHash("sha256").update(key).digest("hex");
}

export function matchRowOf(row: PreparedRow, kind: ImportKind): MatchRow {
	return {
		index: row.index,
		day: row.day,
		currency: row.rate.currency,
		minor: minorKey(row.rate.amount, row.rate.currency),
		kind,
		title: row.title,
		fingerprint: fileFingerprint(row),
	};
}

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

const moneyKey = (x: { kind: string; currency: string; minor: string }) =>
	`${x.kind}|${x.currency}|${x.minor}`;

/** Rows grouped by a key, in the order given. */
function groupBy<T>(items: readonly T[], key: (item: T) => string | null) {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const k = key(item);
		if (k === null) continue;
		const list = groups.get(k);
		if (list) list.push(item);
		else groups.set(k, [item]);
	}
	return groups;
}

/** Hands out each group's rows in order, each at most once (rows only ever become used). */
function takeFirst(
	groups: Map<string, ExistingRow[]>,
	used: Set<string>,
): (key: string) => ExistingRow | null {
	const cursor = new Map<string, number>();
	return (key) => {
		const list = groups.get(key);
		if (!list) return null;
		let at = cursor.get(key) ?? 0;
		while (at < list.length && used.has(list[at]?.id ?? "")) at++;
		cursor.set(key, at);
		const e = list[at];
		if (!e) return null;
		used.add(e.id);
		return e;
	};
}

/** The first index in `days` (sorted) at or above `min`. */
function lowerBound(days: readonly number[], min: number): number {
	let lo = 0;
	let hi = days.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if ((days[mid] ?? 0) < min) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/**
 * Pairs every file row with at most one existing row, and the reverse.
 * Indexed (by fingerprint, by day and description, by amount and day), so a
 * 5,000-row file against a large ledger stays fast inside the commit's
 * transaction.
 */
export function matchRows(
	rows: readonly MatchRow[],
	existing: readonly ExistingRow[],
): Map<number, Match> {
	const used = new Set<string>();
	const exact = new Map<number, ExistingRow>();
	const pass = (
		groups: Map<string, ExistingRow[]>,
		key: (r: MatchRow) => string,
	) => {
		const take = takeFirst(groups, used);
		for (const r of rows) {
			if (exact.has(r.index)) continue;
			const e = take(key(r));
			if (e) exact.set(r.index, e);
		}
	};
	// Exact: a previous import of this row first, then the same row typed in.
	pass(
		groupBy(existing, (e) => e.fingerprint),
		(r) => r.fingerprint,
	);
	const sameRow = (x: ExistingRow | MatchRow) =>
		`${moneyKey(x)}|${x.day}|${normalizeTitle(x.title)}`;
	pass(groupBy(existing, sameRow), sameRow);

	// Likely: same money within LIKELY_DAYS, closest pair first.
	const buckets = new Map(
		[...groupBy(existing, moneyKey)].map(([k, list]) => {
			const sorted = list
				.filter((e) => !used.has(e.id))
				.map((e) => ({ e, day: dayNumber(e.day) }))
				.sort((a, b) => a.day - b.day);
			return [k, { sorted, days: sorted.map((x) => x.day) }] as const;
		}),
	);
	const pairs: { r: MatchRow; e: ExistingRow; d: number }[] = [];
	for (const r of rows) {
		if (exact.has(r.index)) continue;
		const bucket = buckets.get(moneyKey(r));
		if (!bucket) continue;
		const day = dayNumber(r.day);
		for (
			let at = lowerBound(bucket.days, day - LIKELY_DAYS);
			at < bucket.sorted.length;
			at++
		) {
			const c = bucket.sorted[at];
			if (!c || c.day > day + LIKELY_DAYS) break;
			pairs.push({ r, e: c.e, d: Math.abs(c.day - day) });
		}
	}
	pairs.sort((a, b) => a.d - b.d || a.r.index - b.r.index);
	const likely = new Map<number, ExistingRow>();
	for (const { r, e } of pairs) {
		if (likely.has(r.index) || used.has(e.id)) continue;
		used.add(e.id);
		likely.set(r.index, e);
	}

	const out = new Map<number, Match>();
	for (const r of rows)
		out.set(r.index, {
			exact: exact.get(r.index) ?? null,
			likely: likely.get(r.index) ?? null,
		});
	return out;
}

/** Your Activity rows a file could match: its days widened by LIKELY_DAYS, plus earlier imports of its rows. */
export async function existingRows(
	db: Db,
	userId: string,
	rows: readonly MatchRow[],
	dates: readonly Date[],
	timeZone?: string,
): Promise<ExistingRow[]> {
	if (rows.length === 0) return [];
	const times = dates.map((d) => d.getTime());
	const from = new Date(Math.min(...times) - LIKELY_DAYS * DAY_MS);
	const to = new Date(Math.max(...times) + LIKELY_DAYS * DAY_MS);
	const found = await db.expense.findMany({
		where: {
			userId,
			status: "FINALIZED",
			isAmortizedChild: false,
			OR: [
				{
					date: {
						gte: startOfDayIn(from, timeZone),
						lt: startOfNextDayIn(to, timeZone),
					},
				},
				{ importFingerprint: { in: rows.map((r) => r.fingerprint) } },
			],
		},
		orderBy: [{ date: "asc" }, { id: "asc" }],
		select: {
			id: true,
			title: true,
			date: true,
			amount: true,
			currency: true,
			direction: true,
			entryKind: true,
			inType: true,
			importFingerprint: true,
		},
	});
	return found.flatMap((e) => {
		const kind = kindOfColumns(e);
		if (!kind) return [];
		return [
			{
				id: e.id,
				title: e.title,
				day: dayKey(e.date, timeZone),
				currency: e.currency.toUpperCase(),
				minor: minorKey(e.amount, e.currency),
				kind,
				fingerprint: e.importFingerprint,
			},
		];
	});
}

/** The two tiers for a prepared file, each row at `kindOf` its kind. */
export async function matchFile(
	db: Db,
	userId: string,
	rows: readonly PreparedRow[],
	kindOf: (row: PreparedRow) => ImportKind,
	timeZone?: string,
): Promise<Map<number, Match>> {
	const keyed = rows.map((r) => matchRowOf(r, kindOf(r)));
	const existing = await existingRows(
		db,
		userId,
		keyed,
		rows.map((r) => r.date),
		timeZone,
	);
	return matchRows(keyed, existing);
}
