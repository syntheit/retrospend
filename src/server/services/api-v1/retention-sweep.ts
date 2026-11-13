import { env } from "~/env";
import { db } from "~/server/db";
import { deleteFile } from "~/server/storage";

/**
 * Retention for what the mobile app sends for support, swept hourly like the
 * export files (export-sweep.ts), on the owner connection over all users:
 *
 * - error reports are deleted 30 days after they were sent;
 * - the screenshot of an archived feedback entry is deleted 180 days after
 *   the entry was last changed (archiving it is the last change). The entry's
 *   text stays; only the picture goes.
 */

export const ERROR_REPORT_RETENTION_DAYS = 30;
export const ARCHIVED_SCREENSHOT_RETENTION_DAYS = 180;

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

export async function sweepSupportData(now = new Date()) {
	return {
		errorReports: await sweepErrorReports(now),
		screenshots: await sweepArchivedScreenshots(now),
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
