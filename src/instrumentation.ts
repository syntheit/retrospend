/**
 * Runs once when the server starts. It starts the webhook worker, so
 * deliveries that were waiting when the process last stopped go out again
 * without waiting for a write.
 */
export async function register() {
	if (process.env.NEXT_RUNTIME !== "nodejs") return;
	const { startWebhookWorker } = await import(
		"~/server/services/webhooks/worker"
	);
	startWebhookWorker();
}
