/**
 * Runs once when the Node server starts. It starts the work that belongs to
 * the server and to no request: the webhook and push workers, so deliveries
 * that were waiting when the process last stopped go out again, and the
 * hourly sweeps of expired API exports and of old support data
 * (error reports, screenshots of archived feedback). Each starts once per process and is
 * skipped under test.
 */
export async function register() {
	if (process.env.NEXT_RUNTIME !== "nodejs") return;
	const [
		{ startWebhookWorker },
		{ startPushWorker },
		{ startExportSweep },
		{ startRetentionSweep },
	] = await Promise.all([
		import("~/server/services/webhooks/worker"),
		import("~/server/services/push/worker"),
		import("~/server/services/api-v1/export-sweep"),
		import("~/server/services/api-v1/retention-sweep"),
	]);
	startWebhookWorker();
	startPushWorker();
	startExportSweep();
	startRetentionSweep();
}
