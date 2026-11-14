/**
 * The personal-book family of the delta log (E2EE lane P, P14c). These twelve
 * tables carry a bookId (budget_book is its own book), not a userId, so the
 * stamp trigger resolves the owner through the book: its creator, while the
 * book is personal and has no other member (20261114200000_sync_book_family,
 * sync_book_owner). The same twelve names and id columns are in the
 * migration's sync_book_tables(); a pg test fails when they disagree.
 *
 * A loader reads the rows by id for one owner through the Prisma model and
 * asks for the book to be that person's, personal and alone, the same rule as
 * the trigger: a row of a book that was shared since reads as deleted.
 */
import type { Prisma } from "~prisma";

export const SYNCED_BOOK_ENTITIES = [
	"budget_book",
	"envelope_group",
	"envelope",
	"envelope_category",
	"budget_movement",
	"book_period",
	"month_close",
	"income_rule",
	"income_rule_run",
	"payoff_plan",
	"wealth_transfer",
	"envelope_change",
] as const;

export type SyncBookEntity = (typeof SYNCED_BOOK_ENTITIES)[number];

/** The id column of each table when it is not "id". */
export const BOOK_ID_COLUMN: Partial<Record<SyncBookEntity, string>> = {
	income_rule_run: "expenseId",
};

type Tx = Prisma.TransactionClient;

/** A book `userId` made, still personal, with nobody else in it. */
export const soloBook = (userId: string) =>
	({
		createdById: userId,
		isPersonal: true,
		members: { none: { userId: { not: userId } } },
	}) satisfies Prisma.BudgetBookWhereInput;

/** A run is keyed by its expense: `id` is the expense's id, like the others' key. */
const withRunId = <R extends { expenseId: string }>(rows: R[]) =>
	rows.map((row) => ({ ...row, id: row.expenseId }));

export const BOOK_LOADERS = {
	budget_book: (tx: Tx, ids: string[], userId: string) =>
		tx.budgetBook.findMany({
			where: { id: { in: ids }, ...soloBook(userId) },
		}),
	envelope_group: (tx: Tx, ids: string[], userId: string) =>
		tx.envelopeGroup.findMany({
			where: { id: { in: ids }, book: soloBook(userId) },
		}),
	envelope: (tx: Tx, ids: string[], userId: string) =>
		tx.envelope.findMany({
			where: { id: { in: ids }, book: soloBook(userId) },
		}),
	envelope_category: (tx: Tx, ids: string[], userId: string) =>
		tx.envelopeCategory.findMany({
			where: { id: { in: ids }, book: soloBook(userId) },
		}),
	budget_movement: (tx: Tx, ids: string[], userId: string) =>
		tx.budgetMovement.findMany({
			where: { id: { in: ids }, book: soloBook(userId) },
		}),
	book_period: (tx: Tx, ids: string[], userId: string) =>
		tx.bookPeriod.findMany({
			where: { id: { in: ids }, book: soloBook(userId) },
		}),
	month_close: (tx: Tx, ids: string[], userId: string) =>
		tx.monthClose.findMany({
			where: { id: { in: ids }, book: soloBook(userId) },
		}),
	income_rule: (tx: Tx, ids: string[], userId: string) =>
		tx.incomeRule.findMany({
			where: { id: { in: ids }, book: soloBook(userId) },
		}),
	income_rule_run: async (tx: Tx, ids: string[], userId: string) =>
		withRunId(
			await tx.incomeRuleRun.findMany({
				where: { expenseId: { in: ids }, book: soloBook(userId) },
			}),
		),
	payoff_plan: (tx: Tx, ids: string[], userId: string) =>
		tx.payoffPlan.findMany({
			where: { id: { in: ids }, book: soloBook(userId) },
		}),
	wealth_transfer: (tx: Tx, ids: string[], userId: string) =>
		tx.wealthTransfer.findMany({
			where: { id: { in: ids }, book: soloBook(userId) },
		}),
	envelope_change: (tx: Tx, ids: string[], userId: string) =>
		tx.envelopeChange.findMany({
			where: { id: { in: ids }, book: soloBook(userId) },
		}),
} satisfies Record<
	SyncBookEntity,
	(tx: Tx, ids: string[], userId: string) => Promise<{ id: string }[]>
>;
