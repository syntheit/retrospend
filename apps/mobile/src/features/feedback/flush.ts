import type { RetrospendClient } from "@retrospend/api-client";
import { ERROR_REPORT_BATCH_MAX } from "@retrospend/api-contract";
import { newClientId } from "@/data/ids";
import { type ErrorLog, toReport } from "./errorLog";

/**
 * Sends the errors not yet sent to the person's own server, the newest 20 at
 * a time, and marks them sent. A failure leaves them for the next try and
 * says nothing: an error reporter must never be the source of an error.
 * Returns how many went.
 */
export async function flushErrorReports(
	log: ErrorLog,
	api: Pick<RetrospendClient, "feedback">,
): Promise<number> {
	try {
		const entries = (await log.unsent()).slice(-ERROR_REPORT_BATCH_MAX);
		if (entries.length === 0) return 0;
		await api.feedback.submitErrorReports(
			{ reports: entries.map(toReport) },
			{ context: { idempotencyKey: newClientId() } },
		);
		await log.markSent(entries.map((e) => e.id));
		return entries.length;
	} catch {
		return 0;
	}
}
