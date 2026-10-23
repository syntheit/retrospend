/**
 * The preview runner for import.commit and import.undo: the same runner as
 * every money action (forUser), with room for a whole statement. A commit
 * books and writes up to 5,000 rows and reads the figures before and after,
 * which can pass Prisma's 5 s default on a slow host; a timeout would roll
 * the whole batch back, so the import gets IMPORT_TIMEOUT_MS instead.
 */
import { db } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import { type FigureDb, figures } from "~/server/figures/registry";
import { Prisma } from "~prisma";
import { createPreviewRunner, type PreviewRunner } from "../preview/runner";
import type { TransactionPurpose } from "../preview/types";

export const IMPORT_TIMEOUT_MS = 60_000;

const ISOLATION: Record<TransactionPurpose, Prisma.TransactionIsolationLevel> =
	{
		preview: Prisma.TransactionIsolationLevel.RepeatableRead,
		apply: Prisma.TransactionIsolationLevel.ReadCommitted,
	};

export function importRunner(userId: string): PreviewRunner<FigureDb> {
	return createPreviewRunner({
		figures,
		actor: { userId },
		transaction: (work, purpose) =>
			userTransaction(db, userId, work, {
				isolationLevel: ISOLATION[purpose],
				timeout: IMPORT_TIMEOUT_MS,
			}),
	});
}
