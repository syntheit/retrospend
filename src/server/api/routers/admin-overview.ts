import { APP_VERSION } from "~/lib/version";
import { adminProcedure, createTRPCRouter } from "~/server/api/trpc";
import { getStorageSize } from "~/server/storage";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The figures at the top of the admin page (merged into the admin router):
 * people, who was signed in this week, expenses dated this month, what waits
 * for an admin and how the invites are used. Computed here so the page only
 * formats them.
 */
export const adminOverviewRouter = createTRPCRouter({
	getOverview: adminProcedure.query(async ({ ctx }) => {
		const { db } = ctx;
		const now = new Date();
		const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
		const monthStart = new Date(
			Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
		);

		const [
			users,
			activeUsers,
			expensesThisMonth,
			unreadFeedback,
			errorReports,
			invitesUsed,
			invitesOpen,
			dbSize,
		] = await Promise.all([
			db.user.count(),
			db.user.count({
				where: { sessions: { some: { updatedAt: { gte: weekAgo } } } },
			}),
			db.expense.count({
				where: {
					isAmortizedChild: false,
					status: "FINALIZED",
					date: { gte: monthStart },
				},
			}),
			db.feedback.count({ where: { status: "unread" } }),
			db.errorReport.count(),
			db.inviteCode.count({ where: { usedAt: { not: null } } }),
			db.inviteCode.count({ where: { usedAt: null } }),
			db.$queryRaw<Array<{ size: bigint }>>`
				SELECT pg_database_size(current_database()) as size
			`,
		]);

		let mediaBytes = 0;
		try {
			mediaBytes = await getStorageSize();
		} catch {
			// Storage may not be configured; count it as empty.
		}

		return {
			users,
			activeUsers,
			expensesThisMonth,
			unreadFeedback,
			errorReports,
			invitesUsed,
			invitesOpen,
			databaseBytes: Number(dbSize[0]?.size ?? 0),
			mediaBytes,
			version: APP_VERSION,
		};
	}),
});
