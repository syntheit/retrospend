/**
 * Money-in helpers shared by the expense and recurring paths until the income
 * service (2D) lands: the seeded income categories and the row a recurring
 * confirm posts.
 */
import { stripUserTextControls } from "@retrospend/api-contract/common";
import { recurringEntryRow } from "@retrospend/domain/recurring-post/entry-row";
import type { PostTemplate } from "@retrospend/domain/recurring-post/plan";
import { inTransaction, userTransaction } from "~/server/db-tx";
import type { Prisma, PrismaClient } from "~prisma";
import { insertCategoriesOnce } from "./category.service";
import { ensureUserKeyringWhenSealing } from "./keys/data-key.service";
import {
	asBadRequestAsync,
	bookContextOf,
	loadRateContext,
	type RateChoice,
} from "./rate-types";
import { sortByText } from "./text-order";

/** Income categories every user gets on first money in (budget SPEC §12.1). */
export const INCOME_CATEGORIES = [
	{ name: "Salary", color: "emerald" },
	{ name: "Freelance", color: "teal" },
	{ name: "Gifts", color: "pink" },
	{ name: "Interest", color: "cyan" },
	{ name: "Sales", color: "amber" },
	{ name: "Other income", color: "lime" },
] as const;

/**
 * Seeds a user's income categories, once. Seeded on first use rather than
 * in the migration, so today's category pickers, which do not filter by kind
 * yet, never show them to someone who has not recorded money in. A name the
 * user already has (as an expense category too) is left alone, and only a
 * missing name costs the insert, which carries each name's index: the unique
 * keys on the name and on its index absorb a concurrent second insert. A
 * client inserts in a user transaction of its own, after the user's key is
 * made; inside a transaction the insert joins it. A transaction client has a
 * `$transaction` member too, so the open transaction is what decides.
 */
export async function ensureIncomeCategories(
	db: PrismaClient | Prisma.TransactionClient,
	userId: string,
) {
	const rows = await db.category.findMany({ where: { userId } });
	const have = new Set(rows.map((c) => c.name));
	const missing = INCOME_CATEGORIES.filter((c) => !have.has(c.name)).map(
		(c) => ({ ...c, kind: "INCOME" as const }),
	);
	let income = rows.filter((c) => c.kind === "INCOME");
	if (missing.length > 0) {
		const insert = (tx: Prisma.TransactionClient) =>
			insertCategoriesOnce(tx, userId, missing);
		if (inTransaction()) await insert(db as Prisma.TransactionClient);
		else {
			await ensureUserKeyringWhenSealing(userId);
			await userTransaction(db as PrismaClient, userId, insert);
		}
		income = await db.category.findMany({ where: { userId, kind: "INCOME" } });
	}
	// By name, sorted here: a name may be ciphertext in the database (text-order.ts).
	return sortByText(income, (c) => c.name);
}

/** The template fields a confirmed recurring entry is built from. */
export interface DueTemplate {
	id: string;
	userId: string;
	name: string;
	amount: Prisma.Decimal | number;
	currency: string;
	categoryId: string | null;
	nextDueDate: Date;
	direction?: "OUT" | "IN";
	amountMode?: "FIXED" | "ASK";
}

/**
 * A template name as an expense title. A name that starts with U+0001 (an
 * encrypted value that was not opened) throws SealedTextError: the post fails
 * instead of titling an expense with the ciphertext.
 */
export const recurringTitle = (name: string) => stripUserTextControls(name);

/**
 * A stored template as the domain's plans read it. The version stamp is the
 * row's updatedAt: no transport names one yet, so nothing compares it.
 */
export const postTemplateOf = (
	row: Prisma.RecurringTemplateGetPayload<object>,
): PostTemplate => ({ ...row, stamp: row.updatedAt.toISOString() });

/**
 * The row a recurring confirm posts for its due date: the domain's
 * `recurringEntryRow` (direction, amount, the due date's rate, never 1) with
 * the title from the opened name and the rate table read through `db`. "Amount
 * varies: ask me" (ASK) books the amount the user confirmed; a FIXED template
 * books its own and takes none. `choice` is a type or a typed rate; a missing
 * rate throws MissingRateError.
 */
export async function recurringEntryData(
	db: PrismaClient | Prisma.TransactionClient,
	template: DueTemplate,
	/** A decimal string is stored as typed, to the column's 8 decimals. */
	confirmedAmount?: number | string,
	choice: RateChoice = { kind: "table", rateType: null },
	/** The day it was really paid or received; the due date when omitted. */
	paidOn?: Date,
): Promise<Prisma.ExpenseUncheckedCreateInput> {
	const title = recurringTitle(template.name);
	const book = bookContextOf(db, await loadRateContext(db, template.userId));
	const row = await asBadRequestAsync(() =>
		recurringEntryRow(
			{
				...template,
				direction: template.direction ?? "OUT",
				amountMode: template.amountMode ?? "FIXED",
			},
			{ confirmedAmount, choice, paidOn },
			book,
		),
	);
	return { ...row, title };
}
