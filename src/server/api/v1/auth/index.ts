import { getClientIp, ipBucket } from "~/server/lib/rate-limiter";
import { keyedHash } from "~/server/lib/keyed-hash";
import * as recovery from "~/server/services/api-v1/recovery";
import {
	normalizeEmail,
	readPreloginKdf,
} from "~/server/services/protection-keys/prelogin";
import { serve } from "../core/serve";
import { withTries } from "../core/with-tries";
import { type V1Context, v1 } from "../middleware";
import { enforceRateLimit, RATE_LIMITS } from "../rate-limit";

/**
 * The one sender limit of the recovery routes: check, begin and commit share a
 * bucket, so a client that walks the three steps spends three of the ten. It
 * runs first, before the link is looked up. These handlers never read the
 * session (the public-write rule drops it): the account is the link's.
 */
const limitRecoverySender = (context: V1Context) =>
	enforceRateLimit(
		`recovery:ip:${ipBucket(getClientIp(context.headers))}`,
		RATE_LIMITS.recoveryPerIp,
		context.resHeaders,
	);

export const authRouter = {
	prelogin: v1.auth.prelogin.handler(async ({ context, input }) => {
		const email = normalizeEmail(input.email);
		await enforceRateLimit(
			`prelogin:ip:${ipBucket(getClientIp(context.headers))}`,
			RATE_LIMITS.preloginPerIp,
			context.resHeaders,
		);
		// The address is keyed and hashed so the counter table never holds it.
		await enforceRateLimit(
			`prelogin:email:${keyedHash("preloginAddress", email)}`,
			RATE_LIMITS.preloginPerEmail,
			context.resHeaders,
		);
		return { kdf: await readPreloginKdf(input.email) };
	}),
	checkRecovery: v1.auth.checkRecovery.handler(
		serve(async ({ context, input }) => {
			await limitRecoverySender(context);
			return recovery.check(input.token);
		}),
	),
	beginRecovery: v1.auth.beginRecovery.handler(
		serve(async ({ context, input }) => {
			await limitRecoverySender(context);
			return withTries(context, () => recovery.begin(input));
		}),
	),
	recover: v1.auth.recover.handler(
		serve(async ({ context, input }) => {
			await limitRecoverySender(context);
			return withTries(context, () => recovery.commit(input));
		}),
	),
};
