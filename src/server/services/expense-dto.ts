/**
 * What the expense lists send to the client (listFinalized, getExpense,
 * getExpensesByDate). Money columns go out as numbers, as before, and the
 * booked home leg (M2) goes out once, as `home: Money | null` in the list's
 * home currency, so the client shows it instead of converting the USD value
 * at today's rate. The raw Decimal columns homeRate and homeAmount never
 * reach the client.
 */
import type { Expense, Prisma, PrismaClient } from "~prisma";
import { bookedHome } from "./rate-types";

export function expenseDto<T extends Expense>(row: T, homeCurrency: string) {
	const {
		amount,
		amountInUSD,
		exchangeRate,
		homeRate: _homeRate,
		homeAmount: _homeAmount,
		homeCurrency: _homeCurrency,
		...fields
	} = row;
	return {
		...fields,
		amount: Number(amount),
		amountInUSD: Number(amountInUSD),
		exchangeRate: Number(exchangeRate),
		home: bookedHome(row, homeCurrency),
	};
}

/** The user's home currency, the one the lists show booked values in. */
export async function listHomeCurrency(
	db: PrismaClient | Prisma.TransactionClient,
	userId: string,
): Promise<string> {
	const user = await db.user.findUnique({
		where: { id: userId },
		select: { homeCurrency: true },
	});
	return user?.homeCurrency ?? "USD";
}

type ActivityCategory = {
	id: string;
	name: string;
	color: string;
	icon: string | null;
};

/**
 * A personal expense as a dashboard activity row: the booked home value goes
 * with it when it was booked in the currency the dashboard shows.
 */
export function personalActivityItem(
	e: Expense & { category: ActivityCategory | null },
	homeCurrency: string,
) {
	const { category } = e;
	return {
		type: "personal" as const,
		id: e.id,
		title: e.title ?? "Untitled expense",
		amount: Number(e.amount),
		currency: e.currency,
		amountInUSD: e.amountInUSD ? Number(e.amountInUSD) : null,
		home: bookedHome(e, homeCurrency),
		date: e.date,
		category: category
			? {
					id: category.id,
					name: category.name,
					color: category.color,
					icon: category.icon,
				}
			: null,
	};
}
