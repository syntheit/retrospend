/**
 * Money-in helpers shared by the expense and recurring paths until the income
 * service (2D) lands: the seeded income categories and the row a recurring
 * confirm posts.
 */
import { stripUserTextControls } from "@retrospend/api-contract/common";
import { storedAmount } from "@retrospend/domain/rate-booking";
import { TRPCError } from "@trpc/server";
import { inTransaction, userTransaction } from "~/server/db-tx";
import type { Prisma, PrismaClient } from "~prisma";
import { insertCategoriesOnce } from "./category.service";
import { ensureUserKeyringWhenSealing } from "./keys/data-key.service";
import { bookRate, loadRateContext, type RateChoice } from "./rate-types";
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
 * The row a recurring confirm posts for its due date, the in-app twin of the
 * sidecar's auto-post: it copies the template's direction (money in is
 * income), and "Amount varies: ask me" (ASK) books the amount the user
 * confirmed. A FIXED template books its own amount and takes none. The rate
 * is the table rate for the due date at the user's default type (or the
 * `choice` a confirm makes: a type or a typed rate), with the home leg booked
 * like a saved expense (rate-types.ts); a missing rate throws
 * MissingRateError. A template name that starts with U+0001 (an encrypted
 * value that was not opened) throws SealedTextError: the post fails instead
 * of titling an expense with the ciphertext.
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
	const title = stripUserTextControls(template.name);
	const bookedOn = paidOn ?? template.nextDueDate;
	const asks = template.amountMode === "ASK";
	if (asks !== (confirmedAmount !== undefined)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: asks
				? "Confirm the amount for this recurring entry"
				: "This recurring amount is fixed",
		});
	}
	const given = confirmedAmount ?? template.amount;
	// Stored and booked at the column's 8 decimals, half to even, as an expense is.
	const amount = storedAmount(
		typeof given === "object" ? given.toString() : given,
	);
	const rate = await bookRate(
		db,
		await loadRateContext(db, template.userId),
		{
			amount,
			currency: template.currency,
			date: bookedOn,
		},
		choice,
	);
	const isIncome = template.direction === "IN";
	return {
		userId: template.userId,
		title,
		amount,
		currency: template.currency,
		date: bookedOn,
		categoryId: template.categoryId,
		...rate,
		pricingSource: "RECURRING",
		recurringTemplateId: template.id,
		status: "FINALIZED",
		direction: isIncome ? "IN" : "OUT",
		inType: isIncome ? "INCOME" : null,
	};
}
