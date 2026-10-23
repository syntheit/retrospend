/**
 * The one reading of a job's rows that the review shows and the commit
 * writes: dates in the user's zone, the currency override ("Currency" chip),
 * and which rows are already in Activity. Both call these, so the review
 * cannot promise a count the commit does not keep.
 */
import {
	parseDateOnlyIn,
	startOfDayIn,
	startOfNextDayIn,
} from "~/lib/time-zone";
import type { Prisma, PrismaClient } from "~prisma";
import { importFingerprint } from "../csv.service";
import type { ImportRateInput } from "./book";
import {
	type ImportKind,
	kindOfColumns,
	proposeKind,
	type StoredRow,
} from "./rows";

type Db = PrismaClient | Prisma.TransactionClient;

export interface PreparedRow {
	readonly index: number;
	readonly stored: StoredRow;
	readonly title: string;
	readonly date: Date;
	/** YYYY-MM-DD as the file has it. */
	readonly day: string;
	readonly rate: ImportRateInput;
	readonly proposed: ImportKind;
}

export interface Prepared {
	readonly rows: PreparedRow[];
	/** Rows whose date the file has but cannot be read; never imported. */
	readonly badDates: number;
}

/**
 * `currency` replaces every row's currency; the file's rate and USD amount
 * belonged to the old one, so the table decides the rate then.
 */
export function prepareRows(
	stored: readonly StoredRow[],
	options: { currency?: string | null; timeZone?: string },
): Prepared {
	const rows: PreparedRow[] = [];
	let badDates = 0;
	stored.forEach((row, index) => {
		let date: Date;
		try {
			date = parseDateOnlyIn(row.date, options.timeZone);
		} catch {
			badDates++;
			return;
		}
		const override = options.currency?.toUpperCase();
		const currency = override ?? row.currency.toUpperCase();
		rows.push({
			index,
			stored: row,
			title: row.title.trim(),
			date,
			day: row.date,
			rate: {
				amount: row.amount,
				currency,
				date,
				...(override
					? {}
					: { exchangeRate: row.exchangeRate, amountInUSD: row.amountInUSD }),
			},
			proposed: proposeKind(row),
		});
	});
	return { rows, badDates };
}

const keyOf = (kind: ImportKind, fingerprint: string) =>
	`${kind}|${fingerprint}`;

/**
 * "Already in Activity": a finalized row of the same kind, calendar day,
 * title, amount and currency (the fingerprint the old import used, per kind,
 * so an income never hides an expense).
 */
export async function existingKeys(
	db: Db,
	userId: string,
	rows: readonly PreparedRow[],
	timeZone?: string,
): Promise<Set<string>> {
	if (rows.length === 0) return new Set();
	const times = rows.map((r) => r.date.getTime());
	const existing = await db.expense.findMany({
		where: {
			userId,
			status: "FINALIZED",
			isAmortizedChild: false,
			date: {
				gte: startOfDayIn(new Date(Math.min(...times)), timeZone),
				lt: startOfNextDayIn(new Date(Math.max(...times)), timeZone),
			},
		},
		select: {
			date: true,
			title: true,
			amount: true,
			currency: true,
			direction: true,
			entryKind: true,
			inType: true,
		},
	});
	const keys = new Set<string>();
	for (const e of existing) {
		const kind = kindOfColumns(e);
		if (!kind) continue;
		keys.add(
			keyOf(
				kind,
				importFingerprint(
					e.date,
					e.title,
					Number(e.amount),
					e.currency,
					timeZone,
				),
			),
		);
	}
	return keys;
}

export function isDuplicate(
	keys: ReadonlySet<string>,
	row: PreparedRow,
	kind: ImportKind,
	timeZone?: string,
): boolean {
	return keys.has(
		keyOf(
			kind,
			importFingerprint(
				row.date,
				row.title,
				row.rate.amount,
				row.rate.currency,
				timeZone,
			),
		),
	);
}
