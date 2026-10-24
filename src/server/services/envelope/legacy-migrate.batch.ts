/**
 * The batch around migrateLegacyBudget, for `scripts/migrate-to-envelopes.ts`
 * and its tests: every person with old budgets in a transaction of their
 * own, a dry run that rolls each one back (so it writes nothing and still
 * reports exactly what an apply would have written), and the rollback of a
 * run (budget build plan 02 §6 Safety).
 */
import { randomUUID } from "node:crypto";
import { userTransaction } from "~/server/db-tx";
import type { PrismaClient } from "~prisma";
import {
	emptyReport,
	type MigrationReport,
	migrateLegacyBudget,
} from "./legacy-migrate.service";

type Client = Pick<PrismaClient, "$transaction" | "user" | "budgetBook">;

export interface BatchOptions {
	/** False (the default of the script): every person's transaction rolls back. */
	apply: boolean;
	/** Only these people. */
	userIds?: readonly string[];
	now?: Date;
	/** Names the run for a later rollback. */
	runId?: string;
}

class DryRun extends Error {
	constructor(readonly report: MigrationReport) {
		super("dry run");
	}
}

const TIMEOUT_MS = 60_000;

async function migrateOne(
	client: Client,
	userId: string,
	o: Required<Pick<BatchOptions, "apply" | "now" | "runId">>,
): Promise<MigrationReport> {
	try {
		return await userTransaction(
			client,
			userId,
			async (tx) => {
				const report = await migrateLegacyBudget(tx, userId, {
					now: o.now,
					timeZone: null,
					runId: o.runId,
				});
				if (!o.apply) throw new DryRun(report);
				return report;
			},
			{ timeout: TIMEOUT_MS },
		);
	} catch (error) {
		if (error instanceof DryRun) return error.report;
		return {
			...emptyReport(userId, "ERROR"),
			warnings: [error instanceof Error ? error.message : String(error)],
		};
	}
}

/** Everyone with old budgets, one at a time, in id order. */
export async function migrateUsers(
	client: Client,
	options: BatchOptions,
	each?: (report: MigrationReport) => void,
): Promise<{ runId: string; reports: MigrationReport[] }> {
	const runId = options.runId ?? `script-${randomUUID()}`;
	const now = options.now ?? new Date();
	const users = await client.user.findMany({
		where: {
			budgets: { some: {} },
			...(options.userIds ? { id: { in: [...options.userIds] } } : {}),
		},
		orderBy: { id: "asc" },
		select: { id: true },
	});
	const reports: MigrationReport[] = [];
	for (const { id } of users) {
		const report = await migrateOne(client, id, {
			apply: options.apply,
			now,
			runId,
		});
		reports.push(report);
		each?.(report);
	}
	return { runId, reports };
}

export interface RollbackReport {
	runId: string;
	removed: string[];
	/** Books with money the person moved since: left alone unless forced. */
	refused: { userId: string; movements: number }[];
}

/**
 * Deletes the books a run made (envelopes, links, movements and closes go
 * with them). The old `budget` rows were never touched, so the person is
 * back on the old budget when the flag allows it. A book with movements the
 * person made since (anything but plan funding) stays unless `force`.
 */
export async function rollbackRun(
	client: Client,
	runId: string,
	force: boolean,
): Promise<RollbackReport> {
	const books = await client.budgetBook.findMany({
		where: { legacyMigrationRunId: runId },
		select: {
			id: true,
			createdById: true,
			_count: {
				select: { movements: { where: { kind: { not: "PLAN_FUND" } } } },
			},
		},
	});
	const out: RollbackReport = { runId, removed: [], refused: [] };
	for (const b of books) {
		if (b._count.movements > 0 && !force) {
			out.refused.push({
				userId: b.createdById,
				movements: b._count.movements,
			});
			continue;
		}
		await userTransaction(client, b.createdById, (tx) =>
			tx.budgetBook.delete({ where: { id: b.id } }),
		);
		out.removed.push(b.createdById);
	}
	return out;
}
