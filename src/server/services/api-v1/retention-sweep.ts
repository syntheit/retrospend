import { env } from "~/env";
import { db } from "~/server/db";
import { deleteFile } from "~/server/storage";

/**
 * Retention for what the mobile app sends for support, swept hourly like the
 * export files (export-sweep.ts), on the owner connection over all users:
 *
 * - error reports are deleted 90 days after they were sent;
 * - the screenshot of an archived feedback entry is deleted 180 days after
 *   the entry was last changed (archiving it is the last change). The entry's
 *   text stays; only the picture goes;
 * - the file of an import job still waiting or running an hour after it was
 *   created is dropped and the job fails (see sweepStaleImportFiles).
 */

export const ERROR_REPORT_RETENTION_DAYS = 90;
export const ARCHIVED_SCREENSHOT_RETENTION_DAYS = 180;
/** How long a job may wait or run before its file is dropped and it fails. */
export const IMPORT_FILE_RETENTION_MS = 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 200;
const EVERY_MS = 60 * 60 * 1000;

export async function sweepErrorReports(now = new Date()): Promise<number> {
	const cutoff = new Date(now.getTime() - ERROR_REPORT_RETENTION_DAYS * DAY_MS);
	const { count } = await db.errorReport.deleteMany({
		where: { createdAt: { lt: cutoff } },
	});
	return count;
}

export async function sweepArchivedScreenshots(
	now = new Date(),
): Promise<number> {
	const cutoff = new Date(
		now.getTime() - ARCHIVED_SCREENSHOT_RETENTION_DAYS * DAY_MS,
	);
	let removed = 0;
	for (;;) {
		const batch = await db.feedback.findMany({
			where: {
				status: "archived",
				updatedAt: { lt: cutoff },
				screenshotPath: { not: null },
			},
			take: BATCH,
			select: { id: true, screenshotPath: true },
		});
		if (batch.length === 0) return removed;
		for (const row of batch) {
			if (row.screenshotPath)
				await deleteFile(row.screenshotPath).catch(() => {});
		}
		await db.feedback.updateMany({
			where: { id: { in: batch.map((b) => b.id) } },
			data: { screenshotPath: null },
		});
		removed += batch.length;
	}
}

/**
 * An uploaded import file sits in `import_job.fileData`, sealed, until the
 * queue has read it, which takes minutes. A job still QUEUED or PROCESSING an
 * hour after it was created lost its process (a restart, a crash) or never got
 * a slot: its file is cleared and it fails, with no reason text (nothing to
 * seal or leak), so the user sees the ordinary failed state. The queue's own
 * writes only apply while the job is in the status they expect
 * (import-queue.service.ts), so a run that outlives its sweep stays failed.
 *
 * It runs here, not in the queue: it must see every user's jobs, which only
 * the global client does (a queue service holds one user's RLS-scoped client),
 * and it needs no key, because it writes a null. The filter is on status and
 * time, never on `fileData`, which may be ciphertext.
 */
export async function sweepStaleImportFiles(now = new Date()): Promise<number> {
	const cutoff = new Date(now.getTime() - IMPORT_FILE_RETENTION_MS);
	const { count } = await db.importJob.updateMany({
		where: {
			status: { in: ["QUEUED", "PROCESSING"] },
			createdAt: { lt: cutoff },
		},
		data: { fileData: null, status: "FAILED", failedAt: now },
	});
	return count;
}

export async function sweepSupportData(now = new Date()) {
	return {
		errorReports: await sweepErrorReports(now),
		screenshots: await sweepArchivedScreenshots(now),
		importFiles: await sweepStaleImportFiles(now),
	};
}

const started = Symbol.for("retrospend.retentionSweep");

/** Starts the hourly sweep once per server process. */
export function startRetentionSweep(everyMs = EVERY_MS) {
	if (env.NODE_ENV === "test") return;
	const g = globalThis as Record<symbol, unknown>;
	if (g[started]) return;
	const timer = setInterval(() => {
		sweepSupportData().catch((error) => {
			console.error("Retention sweep failed", error);
		});
	}, everyMs);
	// A pending sweep must not keep the process alive.
	timer.unref();
	g[started] = true;
}
