import { env } from "~/env";
import { db } from "~/server/db";
import { removeExport } from "~/server/export-storage";

/**
 * The hourly sweep that makes "files live 24 hours" true for every user, not
 * only those who export again. It runs on the owner connection (no RLS) over
 * all users' expired export_job rows, removing each file and then the row.
 */

const BATCH = 200;
const EVERY_MS = 60 * 60 * 1000;

export async function sweepExpiredExports(now = new Date()): Promise<number> {
	let removed = 0;
	for (;;) {
		const batch = await db.exportJob.findMany({
			where: { expiresAt: { lt: now } },
			take: BATCH,
			select: { id: true, storagePath: true },
		});
		if (batch.length === 0) return removed;
		for (const job of batch) {
			if (job.storagePath) await removeExport(job.storagePath).catch(() => {});
		}
		await db.exportJob.deleteMany({
			where: { id: { in: batch.map((j) => j.id) } },
		});
		removed += batch.length;
	}
}

const started = Symbol.for("retrospend.exportSweep");

/** Starts the hourly sweep once per server process. */
export function startExportSweep(everyMs = EVERY_MS) {
	if (env.NODE_ENV === "test") return;
	const g = globalThis as Record<symbol, unknown>;
	if (g[started]) return;
	const timer = setInterval(() => {
		sweepExpiredExports().catch((error) => {
			console.error("Export sweep failed", error);
		});
	}, everyMs);
	// A pending sweep must not keep the process alive.
	timer.unref();
	g[started] = true;
}
