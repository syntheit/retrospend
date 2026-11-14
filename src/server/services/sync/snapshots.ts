/**
 * The snapshot readers behind GET /sync/shares and GET /sync/settings (E2EE
 * P16): small tables a device takes whole, where the delta log has nothing to
 * stamp (a share belongs to a shared expense, which more than one person owns).
 *
 * A snapshot selects by access only (ownParticipationWhere, the same fragment
 * the server's share reader starts from). It never applies the spending rules,
 * not REJECTED, not a hidden project: the device runs countsAsShare on these
 * rows, the function the server filters its own candidates with. Nothing here
 * reads a title, a note, a payer or another participant (the encryption rules).
 */

import type { db as globalDb } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import type { FigureUnavailable } from "~/server/figures/unavailable";
import { type OwedRead, owedOnce } from "~/server/services/payments/figures";
import {
	getExcludedProjectIds,
	ownExpenseCategoryId,
	ownParticipationWhere,
} from "~/server/services/shared-expense-integration";
import { resolveTimeZone } from "~/server/services/user-time-zone";
import { Prisma } from "~prisma";
import { type BudgetRead, readBudgetBlock, runFreeze } from "./budget-block";

/** One of the caller's participations with the fields of its expense the figures read. */
export interface ShareSnapshotRow {
	id: string;
	expenseId: string;
	shareAmount: Prisma.Decimal;
	verificationStatus: "PENDING" | "ACCEPTED" | "REJECTED" | "AUTO_ACCEPTED";
	currency: string;
	date: Date;
	projectId: string | null;
	exchangeRate: Prisma.Decimal | null;
	/** The expense's category when it is the caller's own (D19), else null. */
	expenseCategoryId: string | null;
}

export interface ShareSnapshot {
	shares: ShareSnapshotRow[];
	owed: OwedRead | FigureUnavailable;
	/** Only when the budget block was asked for. */
	budget?: BudgetRead;
}

/** Longest one statement of the budget block may run: well under the 30 s of the transaction it sits in. */
const BUDGET_STATEMENT_TIMEOUT_MS = 10_000;

/**
 * The budget block inside the snapshot's transaction, isolated: a failure
 * (a bug, a database error) rolls back to a savepoint, so the shares and the
 * owed totals already read still return and the block answers as unavailable.
 * A statement that runs past `timeoutMs` fails inside the savepoint too (the
 * local timeout is undone with it), well before the transaction's own limit
 * would end the whole snapshot.
 */
async function isolatedBudget(
	tx: Prisma.TransactionClient,
	userId: string,
	timeoutMs: number,
): Promise<BudgetRead> {
	await tx.$executeRaw`SAVEPOINT budget_block`;
	try {
		await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(timeoutMs)}, true)`;
		const read = await readBudgetBlock(tx, userId, new Date());
		await tx.$executeRaw`RELEASE SAVEPOINT budget_block`;
		return read;
	} catch (error) {
		console.error(
			"The budget block failed",
			error instanceof Error ? error.name : "unknown",
		);
		await tx.$executeRaw`ROLLBACK TO SAVEPOINT budget_block`;
		return { kind: "unavailable" };
	}
}

/** One repeatable-read read-only transaction: the shares, the owed totals and, when asked, the budget block. */
async function readShares(
	db: typeof globalDb,
	userId: string,
	withBudget: boolean,
	budgetTimeoutMs: number,
): Promise<ShareSnapshot> {
	return userTransaction(
		db,
		userId,
		async (tx) => {
			await tx.$executeRaw`SET TRANSACTION READ ONLY`;
			const rows = await tx.splitParticipant.findMany({
				where: ownParticipationWhere(userId),
				select: {
					id: true,
					transactionId: true,
					shareAmount: true,
					verificationStatus: true,
					transaction: {
						select: {
							currency: true,
							date: true,
							projectId: true,
							exchangeRate: true,
							categoryId: true,
							category: { select: { userId: true } },
						},
					},
				},
				orderBy: { id: "asc" },
			});
			const owed = await owedOnce(tx, userId);
			const budget = withBudget
				? await isolatedBudget(tx, userId, budgetTimeoutMs)
				: undefined;
			return {
				shares: rows.map((p) => ({
					id: p.id,
					expenseId: p.transactionId,
					shareAmount: p.shareAmount,
					verificationStatus: p.verificationStatus,
					currency: p.transaction.currency,
					date: p.transaction.date,
					projectId: p.transaction.projectId,
					exchangeRate: p.transaction.exchangeRate,
					expenseCategoryId: ownExpenseCategoryId(userId, p.transaction),
				})),
				owed,
				...(budget ? { budget } : {}),
			};
		},
		{
			isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
			// A full book load per attempt: longer than the default five seconds at 10k rows.
			...(withBudget ? { timeout: 30_000 } : {}),
		},
	);
}

/** The block saw a value the server had not frozen: freeze again and look again. */
const needsFreeze = (s: ShareSnapshot) =>
	s.budget?.kind === "block" && s.budget.unfrozen > 0;

/**
 * Every participation of `userId`, and Owed to you and You owe, in one
 * repeatable-read read-only transaction: both come from one database snapshot,
 * so a settle-up that commits between the two reads shows in neither or both.
 * The totals are priced at the rates of the moment of the read, as the owed
 * figure always is.
 *
 * With `budget` the same snapshot carries the budget block (budget-block.ts),
 * after a transaction of its own that freezes what the server's budget read
 * would. A block that still finds a value to freeze (a row or a rate day came
 * in between) runs that transaction once more and reads again; a second miss
 * answers the budget as unavailable. Owed and the shares always return.
 */
export async function readShareSnapshot(
	db: typeof globalDb,
	userId: string,
	opts: { budget?: boolean; budgetTimeoutMs?: number } = {},
): Promise<ShareSnapshot> {
	const timeout = opts.budgetTimeoutMs ?? BUDGET_STATEMENT_TIMEOUT_MS;
	if (!opts.budget) return readShares(db, userId, false, timeout);
	await runFreeze(db, userId);
	let snapshot = await readShares(db, userId, true, timeout);
	if (needsFreeze(snapshot)) {
		await runFreeze(db, userId, { force: true });
		snapshot = await readShares(db, userId, true, timeout);
		if (needsFreeze(snapshot))
			snapshot = { ...snapshot, budget: { kind: "unavailable" } };
	}
	return snapshot;
}

export interface SettingsSnapshot {
	homeCurrency: string;
	/** Resolved: the stored zone when supported, else the server default; never null. */
	timeZone: string;
	startDay: number;
	hiddenProjectIds: string[];
	defaultRateTypes: Record<string, string>;
}

/**
 * The settings the figures read, as the device's settings row holds them. The
 * zone is what the figures use with no request zone (resolveTimeZone), and the
 * hidden projects come from the function the spending figures call, so the
 * device cannot read a different month or set of projects than the server.
 */
export async function readSettingsSnapshot(
	db: typeof globalDb,
	userId: string,
): Promise<SettingsSnapshot> {
	return userTransaction(db, userId, async (tx) => {
		const user = await tx.user.findUniqueOrThrow({
			where: { id: userId },
			select: {
				homeCurrency: true,
				timeZone: true,
				fiscalMonthStartDay: true,
				defaultRateTypes: true,
			},
		});
		const stored = user.defaultRateTypes;
		const defaultRateTypes: Record<string, string> = {};
		if (stored && typeof stored === "object" && !Array.isArray(stored))
			for (const [currency, type] of Object.entries(stored))
				if (typeof type === "string") defaultRateTypes[currency] = type;
		return {
			homeCurrency: user.homeCurrency,
			timeZone: resolveTimeZone(user.timeZone),
			startDay: user.fiscalMonthStartDay,
			hiddenProjectIds: await getExcludedProjectIds(tx, userId),
			defaultRateTypes,
		};
	});
}
