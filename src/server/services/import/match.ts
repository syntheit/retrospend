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
import { currencyDecimals } from "~/lib/money";
import { dayKey, startOfDayIn, startOfNextDayIn } from "~/lib/time-zone";
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

const daysApart = (a: string, b: string) =>
	Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) /
	DAY_MS;

const sameMoney = (r: MatchRow, e: ExistingRow) =>
	r.kind === e.kind && r.currency === e.currency && r.minor === e.minor;

/** Pairs every file row with at most one existing row, and the reverse. */
export function matchRows(
	rows: readonly MatchRow[],
	existing: readonly ExistingRow[],
): Map<number, Match> {
	const used = new Set<string>();
	const exact = new Map<number, ExistingRow>();
	const take = (r: MatchRow, pick: (e: ExistingRow) => boolean) => {
		if (exact.has(r.index)) return;
		const e = existing.find((x) => !used.has(x.id) && pick(x));
		if (!e) return;
		used.add(e.id);
		exact.set(r.index, e);
	};
	// Exact: a previous import of this row first, then the same row typed in.
	for (const r of rows) take(r, (e) => e.fingerprint === r.fingerprint);
	const norm = new Map(rows.map((r) => [r.index, normalizeTitle(r.title)]));
	for (const r of rows)
		take(
			r,
			(e) =>
				sameMoney(r, e) &&
				e.day === r.day &&
				normalizeTitle(e.title) === norm.get(r.index),
		);

	// Likely: same money within LIKELY_DAYS, closest pair first.
	const pairs: { r: MatchRow; e: ExistingRow; d: number }[] = [];
	for (const r of rows) {
		if (exact.has(r.index)) continue;
		for (const e of existing) {
			if (used.has(e.id) || !sameMoney(r, e)) continue;
			const d = daysApart(r.day, e.day);
			if (d <= LIKELY_DAYS) pairs.push({ r, e, d });
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
