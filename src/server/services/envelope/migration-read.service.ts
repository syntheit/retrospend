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
import type { Session } from "~/server/better-auth/config";
import { db } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import { isFlagEnabled } from "~/server/flags";
import type { Prisma } from "~prisma";
import { pacingOf } from "./dashboard-pacing";
import { envelopeExportFiles } from "./envelope-export";
import { hiddenRowCount, hiddenRowsIn } from "./hidden-rows";
import { monthViewIn } from "./month-read";
import { prepareRead } from "./read.service";

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

/** The envelope budget as files; none without a book. */
export function getEnvelopeExport(userId: string): Promise<EnvelopeExport> {
	return run(userId, async (tx) => ({
		files: await envelopeExportFiles(tx, userId),
	}));
}

/**
 * The pace line for a dashboard request: envelope totals when the envelope
 * budget is on for the viewer (null without a book), undefined to keep the
 * old budgets.
 */
export async function pacingFor(ctx: {
	session: { user: Session["user"] };
	timeZone?: string;
}): Promise<EnvelopePacing | null | undefined> {
	if (!(await isFlagEnabled("envelopeBudget", ctx.session.user)))
		return undefined;
	return getPacing(ctx.session.user.id, new Date(), ctx.timeZone ?? null);
}

/** The dashboard's pace from envelope totals; null without a book (Just track). */
export function getPacing(
	userId: string,
	now = new Date(),
	timeZone: string | null = null,
): Promise<EnvelopePacing | null> {
	return run(userId, async (tx) => {
		await prepareRead(tx, userId, now, timeZone);
		const view = await monthViewIn(tx, userId, now);
		return view ? pacingOf(view.dto) : null;
	});
}
