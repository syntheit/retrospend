import {
	PasswordTriesExceededError,
	RecoveryTriesExceededError,
} from "~/server/services/account-security.service";
import { problem } from "../errors";
import type { V1Context } from "../middleware";

/**
 * Runs a handler that counts password or recovery-key tries (the web has the
 * same limit) and answers a spent limit as a 429 with Retry-After.
 */
export async function withTries<T>(context: V1Context, run: () => Promise<T>) {
	try {
		return await run();
	} catch (error) {
		if (
			error instanceof PasswordTriesExceededError ||
			error instanceof RecoveryTriesExceededError
		) {
			context.resHeaders?.set("Retry-After", String(error.retryAfterSeconds));
			throw problem("rate_limited", undefined, {
				retryAfter: error.retryAfterSeconds,
			});
		}
		throw error;
	}
}
