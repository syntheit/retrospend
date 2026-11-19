import { os } from "@orpc/server";
import type { ResponseHeadersPluginContext } from "@orpc/server/plugins";
import type { ApiMeta } from "@retrospend/api-contract/common";
import { getClientIp } from "~/server/lib/rate-limiter";
import { consumeRateLimit } from "~/server/services/api-v1/rate-limit.service";
import { problem } from "./errors";
import type { V1Context, V1InitialContext } from "./middleware";

/**
 * Limits (requests per minute). The IP limit runs before authentication,
 * so guessing API keys from one address stops early; the token limit
 * keeps one runaway script from starving a user's other clients.
 */
export const RATE_LIMITS = {
	perIp: { limit: 600, windowMs: 60_000 },
	perToken: { limit: 300, windowMs: 60_000 },
	// Prelogin is public and answers from the database. The IP limit is the
	// real one; the per-address limit is loose on purpose (one address is one
	// person's sign-in, and a stranger must not be able to use it up for them).
	preloginPerIp: { limit: 30, windowMs: 60_000 },
	preloginPerEmail: { limit: 120, windowMs: 60_000 },
	// The recovery routes are public and a link is the only thing that names an
	// account, so one bucket per sender counts check, begin and commit together.
	// The tries per link and per account (RECOVERY_TRIES) are the guessing limit.
	recoveryPerIp: { limit: 10, windowMs: 60_000 },
} as const;

export async function enforceRateLimit(
	key: string,
	{ limit, windowMs }: { limit: number; windowMs: number },
	resHeaders: Headers | undefined,
) {
	const decision = await consumeRateLimit(key, limit, windowMs);
	if (decision.allowed) return;
	resHeaders?.set("Retry-After", String(decision.retryAfterSeconds));
	throw problem("rate_limited", undefined, {
		retryAfter: decision.retryAfterSeconds,
	});
}

export const ipRateLimit = os
	.$context<V1InitialContext & ResponseHeadersPluginContext>()
	.$meta<ApiMeta>({})
	.middleware(async ({ context, next }) => {
		await enforceRateLimit(
			`ip:${getClientIp(context.headers)}`,
			RATE_LIMITS.perIp,
			context.resHeaders,
		);
		return next();
	});

export const tokenRateLimit = os
	.$context<V1Context>()
	.$meta<ApiMeta>({})
	.middleware(async ({ context, next }) => {
		const principal = context.user?.principal;
		if (principal) {
			await enforceRateLimit(
				`tok:${principal.kind}:${principal.tokenId}`,
				RATE_LIMITS.perToken,
				context.resHeaders,
			);
		}
		return next();
	});
