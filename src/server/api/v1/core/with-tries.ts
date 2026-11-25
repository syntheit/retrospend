import {
	PasswordTriesExceededError,
	RecoveryTriesExceededError,
} from "~/server/services/account-security.service";
import { ResetCodeTriesExceededError } from "~/server/services/auth/reset-tokens";
import { problem } from "../errors";
import type { V1Context } from "../middleware";

/**
 * Runs a handler that counts password, recovery-key or reset-code tries (the web has the
 * same limit) and answers a spent limit as a 429 with Retry-After.
 */
export async function withTries<T>(context: V1Context, run: () => Promise<T>) {
	try {
		return await run();
	} catch (error) {
		if (
			error instanceof PasswordTriesExceededError ||
			error instanceof RecoveryTriesExceededError ||
			error instanceof ResetCodeTriesExceededError
		) {
			context.resHeaders?.set("Retry-After", String(error.retryAfterSeconds));
			throw problem("rate_limited", undefined, {
				retryAfter: error.retryAfterSeconds,
			});
		}
		throw error;
	}
}
