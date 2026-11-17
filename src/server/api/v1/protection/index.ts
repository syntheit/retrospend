import { PasswordTriesExceededError } from "~/server/services/account-security.service";
import * as protection from "~/server/services/api-v1/protection";
import { serve } from "../core/serve";
import { problem } from "../errors";
import { type V1Context, signedIn, v1 } from "../middleware";

const p = v1.protection;

/** The same tries limit as a password change: a 429 with Retry-After. */
async function withTries<T>(context: V1Context, run: () => Promise<T>) {
	try {
		return await run();
	} catch (error) {
		if (error instanceof PasswordTriesExceededError) {
			context.resHeaders?.set("Retry-After", String(error.retryAfterSeconds));
			throw problem("rate_limited", undefined, {
				retryAfter: error.retryAfterSeconds,
			});
		}
		throw error;
	}
}

export const protectionRouter = {
	enable: p.enable.handler(
		serve(({ context, input }) =>
			withTries(context, () => protection.enable(signedIn(context), input)),
		),
	),
	keys: p.keys.handler(
		serve(({ context }) => protection.readKeys(signedIn(context))),
	),
	beginPasswordRotation: p.beginPasswordRotation.handler(
		serve(({ context, input }) =>
			withTries(context, () =>
				protection.beginPasswordRotation(
					signedIn(context),
					input.currentAuthKey,
				),
			),
		),
	),
	rotatePassword: p.rotatePassword.handler(
		serve(({ context, input }) =>
			withTries(context, () =>
				protection.changeKeyedPassword(signedIn(context), input),
			),
		),
	),
};
