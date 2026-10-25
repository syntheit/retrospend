/**
 * Runs once when the Node server starts. It starts the work that belongs to
 * the server and to no request: today the hourly sweep of expired API exports.
 */
export async function register() {
	if (process.env.NEXT_RUNTIME !== "nodejs") return;
	const { startExportSweep } = await import(
		"~/server/services/api-v1/export-sweep"
	);
	startExportSweep();
}
