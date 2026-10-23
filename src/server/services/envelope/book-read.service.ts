/**
 * Transport entry points for the P4 book reads and the writes that move no
 * money (acknowledge a summary, pause, resume): each opens one RLS
 * transaction for the user. Money writes go through book.mutation.ts.
 */
import type {
	BankSide,
	PauseResult,
	WelcomeBack,
} from "~/lib/schemas/envelope-book";
import { db } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import type { Prisma } from "~prisma";
import { bankSide } from "./bank";
import { EnvelopeError } from "./errors";
import { ensureMonthsClosed } from "./month-close.service";
import { monthViewIn } from "./month-read";
import { pauseBook, resumeBook } from "./style.service";
import { acknowledgeMonth } from "./summary.service";
import { welcomeBackState } from "./welcome.service";

function run<T>(
	userId: string,
	work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	return userTransaction(db, userId, work);
}

export function getWelcomeBack(
	userId: string,
	now = new Date(),
): Promise<WelcomeBack> {
	return run(userId, async (tx) => {
		await ensureMonthsClosed(tx, userId, now);
		return welcomeBackState(tx, userId, now);
	});
}

/** "Does this match your bank?": what the budget holds against the accounts in it. */
export function getBankCheck(userId: string, now = new Date()): Promise<BankSide> {
	return run(userId, async (tx) => {
		await ensureMonthsClosed(tx, userId, now);
		const view = await monthViewIn(tx, userId, now);
		if (!view) throw new EnvelopeError("NO_BOOK", "start a budget first");
		return bankSide(tx, userId, view);
	});
}

export function acknowledge(
	userId: string,
	input: { month: number; revision: number },
	now = new Date(),
) {
	return run(userId, (tx) => acknowledgeMonth(tx, userId, input, now));
}

export function pause(userId: string, now = new Date()): Promise<PauseResult> {
	return run(userId, (tx) => pauseBook(tx, userId, now));
}

export function resume(userId: string): Promise<PauseResult> {
	return run(userId, (tx) => resumeBook(tx, userId));
}
