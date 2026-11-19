/**
 * The server's adapter for the expense edit core (domain expense-write/edit.ts):
 * the person's row, category and rate table read, and the patch written, on
 * one transaction client. Every query is scoped to the user, so the core
 * decides what a missing row means.
 */
import type {
	ExpenseEditPort,
	StoredExpense,
} from "@retrospend/domain/expense-write/edit";
import { dec } from "@retrospend/domain/precise-decimal";
import type { BookContext } from "@retrospend/domain/rate-booking";
import { findExchangeRate } from "~/server/exchange-rates";
import type { Prisma } from "~prisma";
import { loadRateContext } from "../rate-types";

type Tx = Prisma.TransactionClient;

const text = (v: { toString(): string } | null) =>
	v === null ? null : dec(v).toFixed();

/** A stored row as the core reads it: decimals as plain text, no exponent. */
function storedExpense(
	row: Prisma.ExpenseGetPayload<object>,
	hasLegs: boolean,
): StoredExpense {
	return {
		id: row.id,
		title: row.title,
		amount: dec(row.amount).toFixed(),
		currency: row.currency,
		date: row.date,
		direction: row.direction,
		isAmortizedChild: row.isAmortizedChild,
		isAmortizedParent: row.isAmortizedParent,
		hasLegs,
		exchangeRate: dec(row.exchangeRate).toFixed(),
		amountInUSD: dec(row.amountInUSD).toFixed(),
		rateType: row.rateType,
		homeCurrency: row.homeCurrency,
		homeRate: text(row.homeRate),
		homeAmount: text(row.homeAmount),
		pricingSource: row.pricingSource,
		location: row.location,
		description: row.description,
		categoryId: row.categoryId,
		excludeFromAnalytics: row.excludeFromAnalytics,
	};
}

/** The home currency, the preferred rate type and the rate table, on `tx`. */
export async function bookContextOf(
	tx: Tx,
	userId: string,
): Promise<BookContext> {
	const rates = await loadRateContext(tx, userId);
	return {
		homeCurrency: rates.homeCurrency,
		preferred: rates.preferred,
		find: (currency, date, type) => findExchangeRate(tx, currency, date, type),
	};
}

export interface PrismaEditPort extends ExpenseEditPort {
	/** The row `write` stored, as Prisma returns it (the legacy router's answer). */
	written(): Prisma.ExpenseGetPayload<object>;
}

export function expenseEditPort(tx: Tx, userId: string): PrismaEditPort {
	let written: Prisma.ExpenseGetPayload<object> | undefined;
	return {
		written: () => {
			if (!written) throw new Error("The edit stored no row");
			return written;
		},
		expense: async (id) => {
			const row = await tx.expense.findFirst({
				where: { id, userId },
				include: { _count: { select: { accountLegs: true } } },
			});
			if (!row) return null;
			const { _count, ...own } = row;
			return storedExpense(own, _count.accountLegs > 0);
		},
		category: (id) =>
			tx.category.findFirst({
				where: { id, userId },
				select: { id: true, kind: true, excludeByDefault: true },
			}),
		rateBook: () => bookContextOf(tx, userId),
		write: async (id, patch) => {
			const { excludeFromAnalytics, ...rest } = patch;
			const row = await tx.expense.update({
				where: { id, userId },
				data: {
					...rest,
					...(excludeFromAnalytics !== undefined && { excludeFromAnalytics }),
				},
				include: { _count: { select: { accountLegs: true } } },
			});
			const { _count, ...own } = row;
			written = own;
			return storedExpense(own, _count.accountLegs > 0);
		},
		remove: async (row) => {
			if (row.isAmortizedParent)
				await tx.expense.deleteMany({ where: { parentId: row.id, userId } });
			await tx.expense.delete({ where: { id: row.id } });
		},
	};
}
