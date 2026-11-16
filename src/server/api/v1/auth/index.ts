import { getClientIp, ipBucket } from "~/server/lib/rate-limiter";
import { hashToken } from "~/server/lib/tokens";
import {
	normalizeEmail,
	readPreloginKdf,
} from "~/server/services/protection-keys/prelogin";
import { v1 } from "../middleware";
import { enforceRateLimit, RATE_LIMITS } from "../rate-limit";

export const authRouter = {
	prelogin: v1.auth.prelogin.handler(async ({ context, input }) => {
		const email = normalizeEmail(input.email);
		await enforceRateLimit(
			`prelogin:ip:${ipBucket(getClientIp(context.headers))}`,
			RATE_LIMITS.preloginPerIp,
			context.resHeaders,
		);
		// The address is hashed so the counter table never holds it.
		await enforceRateLimit(
			`prelogin:email:${hashToken(email)}`,
			RATE_LIMITS.preloginPerEmail,
			context.resHeaders,
		);
		return { kdf: await readPreloginKdf(input.email) };
	}),
};
