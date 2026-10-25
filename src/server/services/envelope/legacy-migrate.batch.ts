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

type Client = Pick<
	PrismaClient,
	| "$transaction"
	| "user"
	| "appSettings"
	| "budgetBook"
	| "budgetMovement"
	| "envelope"
	| "envelopeGroup"
	| "incomeRule"
	| "budgetDraft"
	| "wealthTransfer"
	| "payoffPlan"
	| "monthClose"
>;

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

/** True when a run needs a person's eyes: an error, a skipped person, or a book that is not funded or balanced. */
export function needsAttention(reports: readonly MigrationReport[]): number {
	return reports.filter(
		(r) =>
			r.status === "ERROR" ||
			r.status === "MISSING_RATE" ||
			(r.status === "MIGRATED" &&
				(!r.invariantOk || r.warnings.length > 0 || !r.funded)),
	).length;
}

export interface RollbackReport {
	/** The run id, or "lazy" for every first-read move. */
	target: string;
	/** The envelope flag was on and nothing was done (the next read would move them again). */
	blockedByFlag: string | null;
	removed: string[];
	/** Books left alone: what the person did since, which force would lose. */
	refused: { userId: string; changes: string[] }[];
	/** Books removed by force, with what that lost. */
	lost: { userId: string; changes: string[] }[];
}

/** Leeway for the writes of the move itself (colors, funding) after it stamped the book. */
const GRACE_MS = 60_000;

type BookRow = {
	id: string;
	createdById: string;
	legacyMigratedAt: Date | null;
	legacyHiddenIds: string[];
};

/**
 * What the person did in a migrated book since the move, in words: the
 * things a rollback would lose. System writes (plan funding of each month,
 * month closes) are not changes.
 */
async function changesSince(client: Client, b: BookRow): Promise<string[]> {
	const after = new Date((b.legacyMigratedAt?.getTime() ?? 0) + GRACE_MS);
	const book = { bookId: b.id };
	const edited = {
		OR: [{ createdAt: { gt: after } }, { updatedAt: { gt: after } }],
	};
	const counts = {
		moves: await client.budgetMovement.count({
			where: {
				...book,
				OR: [{ kind: { not: "PLAN_FUND" } }, { batchId: null }],
			},
		}),
		envelopes: await client.envelope.count({ where: { ...book, ...edited } }),
		groups: await client.envelopeGroup.count({ where: { ...book, ...edited } }),
		rules: await client.incomeRule.count({ where: book }),
		drafts: await client.budgetDraft.count({ where: book }),
		wealth: await client.wealthTransfer.count({ where: book }),
		plan: await client.payoffPlan.count({ where: book }),
		months: await client.monthClose.count({
			where: { ...book, acknowledgedAt: { not: null } },
		}),
	};
	const line = (n: number, what: string) => (n > 0 ? [`${n} ${what}`] : []);
	return [
		...line(
			counts.moves,
			"money movements the person made (assign, move, cover, limit changes)",
		),
		...line(counts.envelopes, "envelopes added or edited"),
		...line(counts.groups, "groups added or edited"),
		...line(counts.rules, "income rules"),
		...line(counts.drafts, "plan drafts"),
		...line(counts.wealth, "moves to or from Wealth"),
		...line(counts.plan, "debt payoff plans"),
		...line(counts.months, "months acknowledged"),
	];
}

/**
 * Deletes the books of a run (envelopes, links, movements and closes go with
 * them), or of every first-read move with target "lazy". The old `budget`
 * rows were never touched, and the hidden expenses the review answered are
 * hidden again, so the person is back where the old budget left them.
 *
 * Refused (nothing done) while the envelope flag is on: the next read would
 * move the person again. A book the person changed since stays unless
 * `force`, and the report lists what force would lose.
 */
export async function rollbackRun(
	client: Client,
	target: string,
	opts: { force: boolean },
): Promise<RollbackReport> {
	const out: RollbackReport = {
		target,
		blockedByFlag: null,
		removed: [],
		refused: [],
		lost: [],
	};
	const settings = await client.appSettings.findFirst({
		select: { envelopeBudgetMode: true },
	});
	const mode = settings?.envelopeBudgetMode ?? "OFF";
	if (mode !== "OFF" && !opts.force) {
		out.blockedByFlag = mode;
		return out;
	}
	const books: BookRow[] = await client.budgetBook.findMany({
		where:
			target === "lazy"
				? { legacyMigrationRunId: { startsWith: "lazy-" } }
				: { legacyMigrationRunId: target },
		select: {
			id: true,
			createdById: true,
			legacyMigratedAt: true,
			legacyHiddenIds: true,
		},
		orderBy: { id: "asc" },
	});
	for (const b of books) {
		const changes = await changesSince(client, b);
		if (changes.length > 0 && !opts.force) {
			out.refused.push({ userId: b.createdById, changes });
			continue;
		}
		await userTransaction(client, b.createdById, async (tx) => {
			if (b.legacyHiddenIds.length > 0)
				await tx.expense.updateMany({
					where: { id: { in: b.legacyHiddenIds } },
					data: { excludeFromAnalytics: true, entryKind: "STANDARD" },
				});
			await tx.budgetBook.delete({ where: { id: b.id } });
		});
		out.removed.push(b.createdById);
		if (changes.length > 0) out.lost.push({ userId: b.createdById, changes });
	}
	return out;
}
