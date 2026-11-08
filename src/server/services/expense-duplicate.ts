import {
	dayKey,
	parseDateOnlyIn,
	startOfNextDayIn,
} from "@retrospend/domain/time-zone";
import type { Keyring } from "~/server/crypto/field-crypto";
import type { PrismaClient } from "~prisma";
import { pgLower, readUserText, searchesInApp } from "./search-fold";
import { listedEntryWhere } from "./spending";

/** The value as an ILIKE pattern that matches only itself. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");

/**
 * An expense with the same title (any case), amount, currency and day, for
 * the duplicate warning: 50 EUR is not a duplicate of 50 USD. `amount` as
 * decimal text is compared exactly; with a `timeZone` the day is the user's,
 * not the server's. Without a `currency`, any currency matches.
 *
 * Titles may be ciphertext (docs/roadmap/e2ee-spike.md, lane D), so with a
 * `keyring` (the same switch as search and title suggestions, `searchesInApp`)
 * Postgres filters by user, amount, currency and day only, and the titles of
 * those few rows are opened and compared here. The candidates are one day of
 * one amount in one currency, so no row window is needed. Without a keyring
 * Postgres compares the title too, as before. Both compare titles literally and
 * case-insensitively, per code point: no trimming, no accent folding, and `%`,
 * `_` and backslash are ordinary characters. Prisma's insensitive `equals` is
 * `ILIKE`, so the SQL path escapes those three first (`escapeLike`); the app
 * path compares `pgLower` text, the fold ILIKE applies. The `title` returned is
 * the opened text.
 */
export async function findDuplicateExpense(
	db: PrismaClient,
	userId: string,
	input: {
		title: string;
		amount: number | string;
		currency?: string;
		date: Date;
		timeZone?: string;
	},
	options: { keyring?: Keyring } = {},
) {
	let startOfDay: Date;
	let endOfDay: Date;
	if (input.timeZone) {
		startOfDay = parseDateOnlyIn(
			dayKey(input.date, input.timeZone),
			input.timeZone,
		);
		endOfDay = new Date(
			startOfNextDayIn(input.date, input.timeZone).getTime() - 1,
		);
	} else {
		startOfDay = new Date(input.date);
		startOfDay.setHours(0, 0, 0, 0);
		endOfDay = new Date(input.date);
		endOfDay.setHours(23, 59, 59, 999);
	}

	const { keyring } = options;
	const where = {
		// Money in never makes an expense look like a duplicate.
		...listedEntryWhere(userId),
		amount: { equals: input.amount },
		...(input.currency ? { currency: input.currency } : {}),
		date: { gte: startOfDay, lte: endOfDay },
	};

	if (!searchesInApp(keyring))
		return await db.expense.findFirst({
			where: {
				...where,
				title: { equals: escapeLike(input.title), mode: "insensitive" },
			},
			select: { id: true, title: true },
		});

	const wanted = pgLower(input.title);
	const rows = await db.expense.findMany({
		where,
		orderBy: [{ date: "desc" }, { id: "desc" }],
		select: { id: true, title: true },
	});
	for (const row of rows) {
		const title = readUserText(keyring, row.title, {
			table: "expense",
			column: "title",
			rowId: row.id,
		});
		if (pgLower(title) === wanted) return { id: row.id, title };
	}
	return null;
}
