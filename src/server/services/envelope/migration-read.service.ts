/**
 * Transport entry points for the move from the old budget (P7): the notice
 * state, the hidden rows to review, the export and the dashboard's pace. Each
 * opens one RLS transaction for the user. The hidden-rows answers are money
 * writes and live in migration.mutation.ts.
 */
import type {
	EnvelopeExport,
	EnvelopePacing,
	HiddenRowsOutput,
	MigrationState,
} from "~/lib/schemas/envelope-migration";
import { dayKey } from "~/lib/time-zone";
import { db } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import type { Prisma } from "~prisma";
import { pacingOf } from "./dashboard-pacing";
import { envelopeExportFiles, zipExport } from "./envelope-export";
import { hiddenRowCount, hiddenRowsIn } from "./hidden-rows";
import { closedView, movedFirst } from "./read.service";

function run<T>(
	userId: string,
	work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
	return userTransaction(db, userId, work);
}

/** Whether to show "Your limits moved to the new budget", and how many hidden rows wait. */
export function getMigrationState(userId: string): Promise<MigrationState> {
	return run(userId, async (tx) => {
		const book = await tx.budgetBook.findFirst({
			where: { createdById: userId, isPersonal: true },
			select: { legacyMigratedAt: true, legacyNoticeSeenAt: true },
		});
		return {
			migrated: book?.legacyMigratedAt != null,
			noticeOpen:
				book?.legacyMigratedAt != null && book.legacyNoticeSeenAt == null,
			hiddenRows: await hiddenRowCount(tx, userId),
		};
	});
}

/** "Got it" on the notice: it shows once. No money moves. */
export function dismissMigrationNotice(
	userId: string,
	now = new Date(),
): Promise<MigrationState> {
	return run(userId, async (tx) => {
		await tx.budgetBook.updateMany({
			where: {
				createdById: userId,
				isPersonal: true,
				legacyMigratedAt: { not: null },
				legacyNoticeSeenAt: null,
			},
			data: { legacyNoticeSeenAt: now },
		});
		return {
			migrated: true,
			noticeOpen: false,
			hiddenRows: await hiddenRowCount(tx, userId),
		};
	});
}

export function getHiddenRows(userId: string): Promise<HiddenRowsOutput> {
	return run(userId, (tx) => hiddenRowsIn(tx, userId));
}

/** The envelope budget as files and one ZIP; none without a book. `timeZone` dates the file name. */
export function getEnvelopeExport(
	userId: string,
	timeZone?: string,
	now = new Date(),
): Promise<EnvelopeExport> {
	return run(userId, async (tx) => {
		const files = await envelopeExportFiles(tx, userId);
		const day = dayKey(now, timeZone);
		return {
			files,
			zipData: files.length > 0 ? await zipExport(files) : null,
			filename: `retrospend-budget-${day}.zip`,
		};
	});
}

/** The dashboard's pace from envelope totals; null without a book (Just track). */
export function getPacing(
	userId: string,
	now = new Date(),
	timeZone: string | null = null,
): Promise<EnvelopePacing | null> {
	return movedFirst(userId, now, timeZone, () =>
		run(userId, async (tx) => {
			const view = await closedView(tx, userId, now);
			return view ? pacingOf(view.dto) : null;
		}),
	);
}
