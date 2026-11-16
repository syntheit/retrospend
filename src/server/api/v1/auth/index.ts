import { getClientIp } from "~/server/lib/rate-limiter";
import { hashToken } from "~/server/lib/tokens";
import { readPreloginKdf } from "~/server/services/protection-keys/prelogin";
import { v1 } from "../middleware";
import { enforceRateLimit, RATE_LIMITS } from "../rate-limit";

export const authRouter = {
	prelogin: v1.auth.prelogin.handler(async ({ context, input }) => {
		const email = input.email.trim().toLowerCase();
		await enforceRateLimit(
			`prelogin:ip:${getClientIp(context.headers)}`,
			RATE_LIMITS.preloginPerIp,
			context.resHeaders,
		);
		// The address is hashed so the counter table never holds it.
		await enforceRateLimit(
			`prelogin:email:${hashToken(email)}`,
			RATE_LIMITS.preloginPerEmail,
			context.resHeaders,
		);
		return { kdf: await readPreloginKdf(email) };
	}),
};
