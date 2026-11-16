import { PasswordTriesExceededError } from "~/server/services/account-security.service";
import * as protection from "~/server/services/api-v1/protection";
import { serve } from "../core/serve";
import { problem } from "../errors";
import { signedIn, v1 } from "../middleware";

const p = v1.protection;

export const protectionRouter = {
	enable: p.enable.handler(
		serve(async ({ context, input }) => {
			try {
				return await protection.enable(signedIn(context), input);
			} catch (error) {
				// The same tries limit as a password change: a 429 here.
				if (error instanceof PasswordTriesExceededError) {
					context.resHeaders?.set(
						"Retry-After",
						String(error.retryAfterSeconds),
					);
					throw problem("rate_limited", undefined, {
						retryAfter: error.retryAfterSeconds,
					});
				}
				throw error;
			}
		}),
	),
	keys: p.keys.handler(
		serve(({ context }) => protection.readKeys(signedIn(context))),
	),
};
