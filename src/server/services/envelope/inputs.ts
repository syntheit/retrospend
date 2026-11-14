/**
 * Loads one book's engine inputs (build plan 02 §5.3) through the caller's
 * transaction, so RLS applies and a preview sees its own uncommitted rows.
 * The load itself is pure and lives in @retrospend/domain/envelope/load-book,
 * shared with devices; here: the Postgres source it reads through and the
 * writes a server read makes at the end of a load (freezing the values it
 * valued for the first time, one dirty mark for a stale checkpoint).
 *
 * A fixed number of queries, whatever the history length: book with groups,
 * envelopes and links; movements grouped by month and sides; money in;
 * spending and refunds; shares; templates; rates.
 */
import { createHash } from "node:crypto";
import type {
	BookSource,
	LoadedBook as DomainLoadedBook,
} from "@retrospend/domain/envelope/book-source";
import {
	type LoadContext,
	loadBookFrom,
} from "@retrospend/domain/envelope/load-book";
import { parseDateOnlyIn } from "@retrospend/domain/time-zone";
import type { Prisma } from "~prisma";
import { type CloseRow, loadCloseRows, loadDirtyMarks } from "./close-rows";
import { loadDedicatedAccounts } from "./dedicated-goal";
import { prismaBudgetInputs } from "./inputs-source";
import { freezeValues, frozenValues, markDirtyFrom } from "./load-state";
import { loadSplitInputs } from "./splits-input";
import { loadTargetSources } from "./target-sources";
import type { MonthKey } from "./types";

type Tx = Prisma.TransactionClient;

const BOOK_INCLUDE = {
	periods: true,
	groups: { where: { archivedAt: null } },
	envelopes: { include: { categories: { select: { categoryId: true } } } },
} as const;

export type BookRow = NonNullable<Awaited<ReturnType<typeof findPersonalBook>>>;

/** The user's personal book (one per user, D33), or null for "Just track". */
export function findPersonalBook(tx: Tx, userId: string) {
	return tx.budgetBook.findFirst({
		where: { createdById: userId, isPersonal: true },
		include: BOOK_INCLUDE,
	});
}

export type { LoadContext };

/** A loaded book with the server's own row and close types. */
export type LoadedBook = DomainLoadedBook<BookRow, CloseRow>;

const sha256 = (s: string) =>
	createHash("sha256").update(s).digest("base64url");

/** The Postgres side of the budget load, through the caller's transaction. */
export function prismaBookSource(
	tx: Tx,
	userId: string,
): BookSource<BookRow, CloseRow> {
	return {
		book: () => findPersonalBook(tx, userId),
		inputs: (row) => prismaBudgetInputs(tx, userId, row.id),
		closes: (row) => loadCloseRows(tx, row.id),
		dirtyMarks: (row) => loadDirtyMarks(tx, row.id),
		frozenValues: (row) => frozenValues(tx, row.id),
		targetSources: (row, today) => loadTargetSources(tx, row, today),
		dedicatedAccounts: (row) => loadDedicatedAccounts(tx, row),
		splits: () => loadSplitInputs(tx, userId),
		hash: sha256,
	};
}

/** Loads and values every engine input of the user's personal book, or null without one. */
export async function loadBook(
	tx: Tx,
	userId: string,
	ctx: LoadContext,
): Promise<LoadedBook | null> {
	const load = await loadBookFrom(prismaBookSource(tx, userId), ctx);
	if (!load) return null;
	const { loaded, fresh, staleFrom } = load;
	await freezeValues(tx, loaded.row.id, fresh);
	if (staleFrom !== null) await markDirtyFrom(tx, loaded.row.id, staleFrom);
	return loaded;
}

/** Midnight at the start of budget month `month` in the book zone: the book's startDate. */
export function monthStartInstant(
	month: MonthKey,
	startDay: number,
	timeZone: string,
): Date {
	const y = Math.floor(month / 100);
	const mo = month % 100;
	return parseDateOnlyIn(
		`${y}-${String(mo).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`,
		timeZone,
	);
}
