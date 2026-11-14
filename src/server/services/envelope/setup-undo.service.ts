/**
 * Taking back starting a budget (envelope.undoSetup): deletes the book, which
 * takes everything it holds with it (envelopes, groups, links, rules, the
 * first period, the funding movements, the payoff plan), and the starting
 * balance row. Nothing else is ever deleted: the user's own expenses,
 * categories, accounts and the old budget's rows stay.
 *
 * Setup signs a footprint of what it created (ids and update times, never
 * text). The undo recomputes it and refuses once anything differs, because
 * from then on the book holds work the user did and deleting it would lose
 * it. Caches the budget rewrites on its own reads (frozen row values, dirty
 * marks) and the book columns a page open touches are not part of it.
 * Spending logged after setup does not block: the book does not hold it.
 */
import { createHash } from "node:crypto";
import {
	type RestoreToken,
	readRestore,
	signRestore,
} from "~/server/services/entry/restore-token";
import { Prisma } from "~prisma";
import { EnvelopeError } from "./errors";
import { forgetMonthViews } from "./month-read";
import { lockBook } from "./movement-state";

type Tx = Prisma.TransactionClient;

export const SETUP_UNDO_KIND = "envelope.setup.undo";

export interface UndoSetupInput {
	readonly token: RestoreToken;
}

export interface UndoSetupResult {
	bookId: string;
	/** The starting balance row that went with the book; null when setup wrote none. */
	expenseId: string | null;
}

const BOOK_SELECT = {
	id: true,
	isPersonal: true,
	currency: true,
	style: true,
	fundingSource: true,
	pausedAt: true,
	weekStartDay: true,
	monthStartDay: true,
	timeZone: true,
	timeZoneConfirmed: true,
	startDate: true,
	startMonth: true,
	defaultEnvelopeId: true,
	startingBalanceExpenseId: true,
	startingMoneyConfirmedAt: true,
	legacyMigrationRunId: true,
	legacyMigratedAt: true,
	legacyNoticeSeenAt: true,
	legacyHiddenIds: true,
	reconciledAt: true,
	planFundFrom: true,
	styleUndo: true,
	payFrequency: true,
	payAnchor: true,
	createdById: true,
	createdAt: true,
} as const satisfies Prisma.BudgetBookSelect;

/**
 * BudgetBook columns the footprint covers: a change to any of them means the
 * book was used. Every column of the model is in exactly one of the two lists
 * (setup-undo-footprint.test.ts), so a new column cannot be forgotten.
 */
export const BOOK_DIGEST_COLUMNS: readonly string[] = Object.keys(BOOK_SELECT);

/**
 * Columns a plain page open or a rename touches, so they say nothing about
 * money: the book's last read, Welcome back's timer, the dirty mark, the
 * name and the row's own update time (guard.ts, welcome.service.ts).
 */
export const BOOK_IGNORED_COLUMNS: readonly string[] = [
	"name",
	"dirtyFromMonth",
	"lastOpenedAt",
	"welcomeBackFrom",
	"updatedAt",
];

type RowsOf = (tx: Tx, bookId: string) => Promise<unknown[]>;

/**
 * The tables a book owns, as setup leaves them. Rows are read as ids plus the
 * non-text columns that change in place (update times), so nothing sealed is
 * opened. Ignored on purpose: budget_dirty and budget_row_value, caches the
 * budget rewrites whenever a page reads it.
 */
const FAMILY: readonly { table: string; rows: RowsOf }[] = [
	{
		table: "envelope_group",
		rows: (tx, bookId) =>
			tx.envelopeGroup.findMany({
				where: { bookId },
				select: { id: true, updatedAt: true },
				orderBy: { id: "asc" },
			}),
	},
	{
		table: "envelope",
		rows: (tx, bookId) =>
			tx.envelope.findMany({
				where: { bookId },
				select: { id: true, updatedAt: true },
				orderBy: { id: "asc" },
			}),
	},
	{
		table: "envelope_category",
		rows: (tx, bookId) =>
			tx.envelopeCategory.findMany({
				where: { bookId },
				select: { id: true },
				orderBy: { id: "asc" },
			}),
	},
	{
		table: "budget_movement",
		rows: (tx, bookId) =>
			tx.budgetMovement.findMany({
				where: { bookId },
				select: { id: true },
				orderBy: { id: "asc" },
			}),
	},
	{
		table: "book_period",
		rows: (tx, bookId) =>
			tx.bookPeriod.findMany({
				where: { bookId },
				select: { id: true, fromMonth: true, startDay: true, rateType: true },
				orderBy: { id: "asc" },
			}),
	},
	{
		table: "budget_member",
		rows: (tx, bookId) =>
			tx.budgetMember.findMany({
				where: { bookId },
				select: { id: true, userId: true, role: true },
				orderBy: { id: "asc" },
			}),
	},
	{
		table: "month_close",
		rows: (tx, bookId) =>
			tx.monthClose.findMany({
				where: { bookId },
				select: { id: true, revision: true, acknowledgedAt: true },
				orderBy: { id: "asc" },
			}),
	},
	{
		table: "income_rule",
		rows: (tx, bookId) =>
			tx.incomeRule.findMany({
				where: { bookId },
				select: { id: true, updatedAt: true },
				orderBy: { id: "asc" },
			}),
	},
	{
		table: "income_rule_run",
		rows: (tx, bookId) =>
			tx.incomeRuleRun.findMany({
				where: { bookId },
				select: { expenseId: true, updatedAt: true },
				orderBy: { expenseId: "asc" },
			}),
	},
	{
		table: "payoff_plan",
		rows: (tx, bookId) =>
			tx.payoffPlan.findMany({
				where: { bookId },
				select: { id: true, updatedAt: true },
				orderBy: { id: "asc" },
			}),
	},
	{
		table: "wealth_transfer",
		rows: (tx, bookId) =>
			tx.wealthTransfer.findMany({
				where: { bookId },
				select: { id: true },
				orderBy: { id: "asc" },
			}),
	},
	{
		table: "envelope_change",
		rows: (tx, bookId) =>
			tx.envelopeChange.findMany({
				where: { bookId },
				select: { id: true, undoneAt: true },
				orderBy: { id: "asc" },
			}),
	},
	{
		table: "budget_draft",
		rows: (tx, bookId) =>
			tx.budgetDraft.findMany({
				where: { bookId },
				select: { id: true, updatedAt: true },
				orderBy: { id: "asc" },
			}),
	},
];

export const FOOTPRINT_TABLES: readonly string[] = FAMILY.map((f) => f.table);

/**
 * Tables whose rows are edited in place without touching the book, so the
 * book row's lock alone would not hold an edit back (an insert does take it:
 * its foreign key shares the book row). Each has UPDATE for the app role.
 */
const EDITED_IN_PLACE = [
	"envelope_group",
	"envelope",
	"income_rule",
	"payoff_plan",
	"budget_draft",
	"book_period",
] as const;

/** What setup created, as digests: any difference later means the book was used. */
export interface SetupFootprint {
	readonly bookId: string;
	readonly book: string;
	/** The starting balance row: id and update time, or null when setup wrote none. */
	readonly expense: { id: string; updatedAt: string } | null;
	/** Entry rows (starting balance, Adjustments, not spending) dated from the book's start on. */
	readonly entries: string;
	readonly tables: Readonly<Record<string, string>>;
}

const digest = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function bookDigest(tx: Tx, bookId: string) {
	const row = await tx.budgetBook.findUniqueOrThrow({
		where: { id: bookId },
		select: BOOK_SELECT,
	});
	return { digest: digest(row), row };
}

/**
 * The footprint of a book as it stands: setup signs it, the undo recomputes
 * it. `startDate` bounds the entry rows the user's ledger may hold for the
 * book (Adjustments from Welcome back or reconcile are written later, with
 * ids setup never saw).
 */
export async function setupFootprint(
	tx: Tx,
	userId: string,
	bookId: string,
): Promise<SetupFootprint> {
	const { digest: book, row } = await bookDigest(tx, bookId);
	const expense = row.startingBalanceExpenseId
		? await tx.expense.findUnique({
				where: { id: row.startingBalanceExpenseId },
				select: { id: true, updatedAt: true },
			})
		: null;
	const entries = await tx.expense.findMany({
		where: {
			userId,
			entryKind: { not: "STANDARD" },
			date: { gte: row.startDate },
		},
		select: { id: true },
		orderBy: { id: "asc" },
	});
	const tables: Record<string, string> = {};
	for (const f of FAMILY) tables[f.table] = digest(await f.rows(tx, bookId));
	return {
		bookId,
		book,
		expense: expense
			? { id: expense.id, updatedAt: expense.updatedAt.toISOString() }
			: null,
		entries: digest(entries),
		tables,
	};
}

/** The token setup returns: the footprint, signed for the user, good for 24 hours. */
export function signSetupUndo(userId: string, footprint: SetupFootprint) {
	return signRestore(SETUP_UNDO_KIND, userId, footprint);
}

/** The parts of the book that no longer match what setup created, named by table. */
function changedParts(a: SetupFootprint, b: SetupFootprint): string[] {
	const changed: string[] = [];
	if (a.book !== b.book) changed.push("budget_book");
	if (JSON.stringify(a.expense) !== JSON.stringify(b.expense))
		changed.push("expense");
	if (a.entries !== b.entries) changed.push("entries");
	for (const f of FAMILY)
		if (a.tables[f.table] !== b.tables[f.table]) changed.push(f.table);
	return changed;
}

const inUse = (what: string) =>
	new EnvelopeError(
		"BOOK_IN_USE",
		`the budget has been used since it was set up (${what})`,
	);

/** A lock wait that ended in a serialization failure or a deadlock: someone else is writing the book. */
function isContention(error: unknown): boolean {
	const e = error as { code?: string; message?: string; meta?: unknown };
	return (
		e?.code === "P2034" ||
		/could not serialize|deadlock detected|\b40001\b|\b40P01\b/i.test(
			`${e?.message ?? ""} ${JSON.stringify(e?.meta ?? "")}`,
		)
	);
}

/**
 * One writer at a time: the book's advisory lock (movements, closes), then
 * the book row, then the rows edited in place. A write that lands after this
 * waits for the commit and finds the book gone. False when the book is gone.
 */
async function lockFamily(tx: Tx, bookId: string): Promise<boolean> {
	await lockBook(tx, bookId);
	const book = await tx.$queryRaw<
		{ id: string }[]
	>`SELECT "id" FROM "budget_book" WHERE "id" = ${bookId} FOR UPDATE`;
	if (book.length === 0) return false;
	for (const table of EDITED_IN_PLACE)
		await tx.$executeRaw(
			Prisma.sql`SELECT "id" FROM ${Prisma.raw(`"${table}"`)} WHERE "bookId" = ${bookId} ORDER BY "id" FOR UPDATE`,
		);
	return true;
}

/** Rows elsewhere that point at what is about to go; deleting would null them or take them along. */
async function referenceCount(
	tx: Tx,
	bookId: string,
	expenseId: string | null,
): Promise<number> {
	const [row] = await tx.$queryRaw<{ n: number }[]>`SELECT (
		(SELECT count(*) FROM "settlement" WHERE "forgiveEnvelopeId" IN (SELECT "id" FROM "envelope" WHERE "bookId" = ${bookId})) +
		(SELECT count(*) FROM "project_participant" WHERE "budgetEnvelopeId" IN (SELECT "id" FROM "envelope" WHERE "bookId" = ${bookId})) +
		(SELECT count(*) FROM "expense" WHERE "budgetEnvelopeId" IN (SELECT "id" FROM "envelope" WHERE "bookId" = ${bookId})) +
		(SELECT count(*) FROM "account_leg" WHERE "expenseId" = ${expenseId}) +
		(SELECT count(*) FROM "expense" WHERE "parentId" = ${expenseId}) +
		(SELECT count(*) FROM "transfer" WHERE "feeExpenseId" = ${expenseId}) +
		(SELECT count(*) FROM "wealth_transfer" WHERE "sourceExpenseId" = ${expenseId})
	)::int AS n`;
	return row?.n ?? 0;
}

/**
 * Deletes the book setup made and its starting balance row, or refuses with
 * BOOK_IN_USE. The book goes first: its cascade removes the movements that
 * name the row, and a row deleted first would null the book's pointer.
 */
export async function undoSetup(
	tx: Tx,
	userId: string,
	input: UndoSetupInput,
): Promise<UndoSetupResult> {
	const signed = readRestore<SetupFootprint>(
		input.token,
		SETUP_UNDO_KIND,
		userId,
	);
	try {
		if (!(await lockFamily(tx, signed.bookId)))
			throw new EnvelopeError(
				"ALREADY_UNDONE",
				"that budget was already taken back",
			);
	} catch (error) {
		if (isContention(error)) throw inUse("being changed right now");
		throw error;
	}
	const book = await tx.budgetBook.findFirst({
		where: { id: signed.bookId, createdById: userId, isPersonal: true },
		select: { legacyMigratedAt: true },
	});
	if (!book)
		throw new EnvelopeError(
			"ALREADY_UNDONE",
			"that budget was already taken back",
		);
	// Computed after both locks: what it reads is what the delete will remove.
	const now = await setupFootprint(tx, userId, signed.bookId);
	const changed = changedParts(signed, now);
	if (changed.length > 0) throw inUse(changed.join(", "));
	// Without the book, the first read would move the old limits in again behind a "no budget" answer.
	if (
		!book.legacyMigratedAt &&
		(await tx.budget.count({ where: { userId } })) > 0
	)
		throw inUse("old limits are waiting to move in");
	if ((await referenceCount(tx, signed.bookId, signed.expense?.id ?? null)) > 0)
		throw inUse("something else points at it");
	await tx.budgetBook.delete({ where: { id: signed.bookId } });
	// Only the user's own starting balance row, whatever a token says.
	if (signed.expense)
		await tx.expense.delete({
			where: { id: signed.expense.id, userId, entryKind: "STARTING_BALANCE" },
		});
	forgetMonthViews(tx);
	return { bookId: signed.bookId, expenseId: signed.expense?.id ?? null };
}
