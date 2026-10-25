/**
 * The lazy entry point of the move from the old budget (budget build plan 02
 * §6): the first budget read of a person with old limits and no book moves
 * them in. It never runs inside a read's own transaction (a 5 s clock a big
 * history could outrun) and never fails the read: the move gets a
 * transaction of its own with a 60 s timeout, an error is caught and kept,
 * and the read goes on as "Just track". People it did not move are tried
 * again after a pause, not on every read; the script (or a later read) does
 * the rest.
 */
import { randomUUID } from "node:crypto";
import { userTransaction } from "~/server/db-tx";
import type { PrismaClient } from "~prisma";
import {
	emptyReport,
	type MigrationReport,
	migrateLegacyBudget,
} from "./legacy-migrate.service";

type Client = Pick<PrismaClient, "$transaction" | "budgetBook" | "budget">;

/** A rate may arrive with the daily sync. */
const RETRY_NO_RATE_MS = 10 * 60_000;
/** An error needs a person to look; do not hammer the database meanwhile. */
const RETRY_ERROR_MS = 30 * 60_000;
const MOVE_TIMEOUT_MS = 60_000;

const notMoved = new Map<string, { at: number; wait: number }>();

/** The throttle is per process; forget it (tests, and a fix deployed to a running process). */
export function forgetLegacyAttempts() {
	notMoved.clear();
}

/**
 * Moves the person in when they have old budgets and no book. Returns null
 * when there is nothing to do or it is too soon to try again, the report
 * otherwise. MIGRATED and HAS_BOOK (a read at the same moment moved them
 * first) mean the caller should read again.
 */
export async function ensureLegacyBook(
	client: Client,
	userId: string,
	now: Date,
	timeZone: string | null,
): Promise<MigrationReport | null> {
	const book = await client.budgetBook.findFirst({
		where: { createdById: userId, isPersonal: true },
		select: { id: true },
	});
	if (book) return emptyReport(userId, "HAS_BOOK");
	const tried = notMoved.get(userId);
	if (tried && now.getTime() - tried.at < tried.wait) return null;
	if (
		!(await client.budget.findFirst({
			where: { userId },
			select: { id: true },
		}))
	)
		return null;
	try {
		const report = await userTransaction(
			client,
			userId,
			(tx) =>
				migrateLegacyBudget(tx, userId, {
					now,
					timeZone,
					runId: `lazy-${randomUUID()}`,
				}),
			{ timeout: MOVE_TIMEOUT_MS },
		);
		if (report.status === "MIGRATED" || report.status === "HAS_BOOK")
			notMoved.delete(userId);
		else notMoved.set(userId, { at: now.getTime(), wait: RETRY_NO_RATE_MS });
		return report;
	} catch (error) {
		console.error("legacy budget move failed", userId, error);
		notMoved.set(userId, { at: now.getTime(), wait: RETRY_ERROR_MS });
		return {
			...emptyReport(userId, "ERROR"),
			warnings: [error instanceof Error ? error.message : String(error)],
		};
	}
}
