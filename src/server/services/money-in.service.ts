/**
 * Money-in helpers shared by the expense and recurring paths until the income
 * service (2D) lands: the seeded income categories and the row a recurring
 * confirm posts.
 */
import { TRPCError } from "@trpc/server";
import { computeAmountInUSD } from "~/lib/money";
import type { Prisma, PrismaClient } from "~prisma";
import { requireExchangeRate } from "../exchange-rates";

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
 * yet, never show them to someone who has not recorded money in. Safe to
 * call concurrently: the (name, userId) unique key absorbs a second insert.
 * A name the user already has as an expense category is left alone.
 */
export async function ensureIncomeCategories(
	db: PrismaClient | Prisma.TransactionClient,
	userId: string,
) {
	await db.category.createMany({
		data: INCOME_CATEGORIES.map((category) => ({
			...category,
			kind: "INCOME" as const,
			userId,
		})),
		skipDuplicates: true,
	});
	return db.category.findMany({
		where: { userId, kind: "INCOME" },
		orderBy: { name: "asc" },
	});
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
 * is the table rate for the due date; a currency without one fails.
 */
export async function recurringEntryData(
	db: PrismaClient | Prisma.TransactionClient,
	template: DueTemplate,
	confirmedAmount?: number,
): Promise<Prisma.ExpenseUncheckedCreateInput> {
	const asks = template.amountMode === "ASK";
	if (asks !== (confirmedAmount !== undefined)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: asks
				? "Confirm the amount for this recurring entry"
				: "This recurring amount is fixed",
		});
	}
	const amount = confirmedAmount ?? template.amount;
	const { rate: exchangeRate } = await requireExchangeRate(
		db,
		template.currency,
		template.nextDueDate,
	);
	const isIncome = template.direction === "IN";
	return {
		userId: template.userId,
		title: template.name,
		amount,
		currency: template.currency,
		date: template.nextDueDate,
		categoryId: template.categoryId,
		amountInUSD: computeAmountInUSD(
			Number(amount),
			template.currency,
			exchangeRate,
		),
		exchangeRate,
		pricingSource: "RECURRING",
		recurringTemplateId: template.id,
		status: "FINALIZED",
		direction: isIncome ? "IN" : "OUT",
		inType: isIncome ? "INCOME" : null,
	};
}
