/**
 * Recent imports (import.html step 1): one row per job with one status,
 * Reading (queued or being read, with its progress), Ready to review, Failed
 * or Imported. Imported jobs carry the days their rows landed on, so View
 * opens Activity on those days. Jobs older than the queue keeps (24 hours)
 * and cancelled ones are left out, like today's queue panel.
 */
import type { Prisma, PrismaClient } from "~prisma";
import { storedRows } from "./rows";

type Db = PrismaClient | Prisma.TransactionClient;

const KEPT_MS = 24 * 60 * 60 * 1000;
const LIMIT = 20;

export type RecentState = "reading" | "review" | "failed" | "imported";

export interface RecentImport {
	readonly id: string;
	readonly fileName: string;
	readonly state: RecentState;
	/** Queued: waiting for a free reader; it can still be cancelled. */
	readonly queued: boolean;
	/** 0 to 100 while reading, when the reader reports it. */
	readonly percent: number | null;
	/** Rows read (review) or created (imported). */
	readonly count: number;
	readonly error: string | null;
	/** When it finished (imported) or was created. */
	readonly at: string;
	readonly from: string | null;
	readonly to: string | null;
	/** Imported here: Undo import can take it back. */
	readonly undoable: boolean;
}

function stateOf(status: string): RecentState | null {
	switch (status) {
		case "QUEUED":
		case "PROCESSING":
			return "reading";
		case "READY_FOR_REVIEW":
		case "REVIEWING":
			return "review";
		case "FAILED":
			return "failed";
		case "COMPLETED":
			return "imported";
		default:
			return null;
	}
}

export async function recentImports(
	db: Db,
	userId: string,
): Promise<RecentImport[]> {
	const jobs = await db.importJob.findMany({
		where: {
			userId,
			status: { not: "CANCELLED" },
			createdAt: { gte: new Date(Date.now() - KEPT_MS) },
		},
		orderBy: { createdAt: "desc" },
		take: LIMIT,
		select: {
			id: true,
			fileName: true,
			status: true,
			progressPercent: true,
			totalTransactions: true,
			importedCount: true,
			errorMessage: true,
			createdAt: true,
			completedAt: true,
		},
	});
	// Only imported jobs need their rows (the days they landed on).
	const done = jobs.filter((j) => j.status === "COMPLETED").map((j) => j.id);
	const rowsOf = new Map(
		done.length === 0
			? []
			: (
					await db.importJob.findMany({
						where: { id: { in: done }, userId },
						select: { id: true, transactions: true },
					})
				).map((j) => [j.id, storedRows(j.transactions)]),
	);
	return jobs.flatMap((job) => {
		const state = stateOf(job.status);
		if (!state) return [];
		const created = (rowsOf.get(job.id) ?? []).filter((r) => r.expenseId);
		const days = created.map((r) => r.date).sort();
		return [
			{
				id: job.id,
				fileName: job.fileName,
				state,
				queued: job.status === "QUEUED",
				percent:
					state === "reading" && job.progressPercent != null
						? Math.round(job.progressPercent * 100)
						: null,
				count:
					state === "imported"
						? (job.importedCount ?? 0)
						: job.totalTransactions,
				error: state === "failed" ? job.errorMessage : null,
				at: (job.completedAt ?? job.createdAt).toISOString(),
				from: days[0] ?? null,
				to: days.at(-1) ?? null,
				undoable: created.length > 0,
			},
		];
	});
}
