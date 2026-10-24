import {
	dayKey,
	parseDateOnlyIn,
	startOfNextDayIn,
} from "@retrospend/domain/time-zone";
import type { PrismaClient } from "~prisma";
import { listedEntryWhere } from "./spending";

/**
 * An expense with the same title (any case), amount and day, for the
 * duplicate warning. `amount` as decimal text is compared exactly; with a
 * `timeZone` the day is the user's, not the server's.
 */
export async function findDuplicateExpense(
	db: PrismaClient,
	userId: string,
	input: {
		title: string;
		amount: number | string;
		date: Date;
		timeZone?: string;
	},
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

	return await db.expense.findFirst({
		where: {
			// Money in never makes an expense look like a duplicate.
			...listedEntryWhere(userId),
			title: { equals: input.title, mode: "insensitive" },
			amount: { equals: input.amount },
			date: { gte: startOfDay, lte: endOfDay },
		},
		select: { id: true, title: true },
	});
}
