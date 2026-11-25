import { env } from "~/env";
import { AdminFailureError, workerFailure } from "./admin-failure";
import { IntegrationService } from "./integration.service";

/** The sidecar answers 409 while a backup is still running. */
const ALREADY_RUNNING = 409;

/**
 * Asks the sidecar to back up now. It answers once the backup is accepted;
 * the run itself goes on in the sidecar. A failure the sidecar's answer
 * explains is an AdminFailureError; anything else is thrown as it is.
 */
export async function requestBackup(): Promise<unknown> {
	if (!env.WORKER_API_KEY) throw new AdminFailureError("backup_unavailable");
	try {
		const response = await IntegrationService.requestWorker(
			`${env.SIDECAR_URL}/backups/run`,
			{ method: "POST", timeout: 300000 },
		);
		return await response.json();
	} catch (error) {
		const failure = workerFailure(error);
		if (!failure) throw error;
		if (failure.kind === "no-answer")
			throw new AdminFailureError("backup_unavailable");
		if (failure.kind === "refused" && failure.status === ALREADY_RUNNING)
			throw new AdminFailureError("backup_running");
		throw new AdminFailureError("backup_failed");
	}
}
