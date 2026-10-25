/**
 * Runs once when the Node server starts. It starts the work that belongs to
 * the server and to no request: the webhook worker, so deliveries that were
 * waiting when the process last stopped go out again, and the hourly sweep
 * of expired API exports. Each starts once per process and is skipped under
 * test.
 */
export async function register() {
	if (process.env.NEXT_RUNTIME !== "nodejs") return;
	const [{ startWebhookWorker }, { startExportSweep }] = await Promise.all([
		import("~/server/services/webhooks/worker"),
		import("~/server/services/api-v1/export-sweep"),
	]);
	startWebhookWorker();
	startExportSweep();
}
