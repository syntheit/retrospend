/**
 * Reads a project's summary numbers through any client, including a preview
 * transaction, so figures and the summary page share one code path. No
 * global db: callers pass an RLS-scoped client or transaction.
 */
import type { Prisma, PrismaClient } from "~prisma";
import { fetchProjectLedger } from "./ledger";
import { type ProjectNumbers, summarizeLedger } from "./summary";
import type { ProjectViewer } from "./types";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Which counted payments a reader's summary includes. Today every payment
 * in BALANCE_SETTLEMENT_STATUSES counts for everyone, as in every project
 * view (settlement plan, billing periods, exports).
 *
 * Seam for I5 (viewer-relative pending, track 2C): when the balance service
 * takes a viewer, a pending payment to `viewer` stops counting here, through
 * that service's rule, never a copy of it. Until then `viewer` is unused.
 */
export function paymentsCountedFor<S>(
	_viewer: ProjectViewer,
	settlements: S[],
): S[] {
	return settlements;
}

export async function readProjectNumbers(
	db: Db,
	projectId: string,
	viewer: ProjectViewer,
	periodId?: string,
): Promise<ProjectNumbers> {
	const [ledger, members] = await Promise.all([
		fetchProjectLedger(db, projectId, periodId),
		(db as PrismaClient).projectParticipant.findMany({
			where: { projectId },
			select: { participantType: true, participantId: true },
			orderBy: { joinedAt: "asc" },
		}),
	]);
	return summarizeLedger(
		{
			transactions: ledger.transactions,
			settlements: paymentsCountedFor(viewer, ledger.settlements),
		},
		members,
	);
}
