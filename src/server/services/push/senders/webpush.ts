import { sendWebhook } from "~/server/services/webhooks/send";
import type { Resolver } from "~/server/services/webhooks/ssrf";
import type { WebPushConfig } from "../config";
import { signJwt } from "./jwt";
import { parseRetryAfter } from "./retry-after";
import type { PushMessage, PushSender, PushTarget, SendOutcome } from "./types";
import { encryptWebPush, WebPushKeyError } from "./webpush-crypto";

/**
 * Web Push to a UnifiedPush distributor's endpoint (RFC 8030, 8291, 8292).
 * The endpoint is a URL the device registered, so the server is told where
 * to connect by a user: it goes through the webhook sender's target check
 * (DNS answers screened, the connection pinned to what passed, no
 * redirects) and is refused when it is private, unless the admin allowed
 * private targets or the operator listed the host.
 */

const VAPID_LIFETIME_S = 12 * 60 * 60;

export type WebPushOptions = {
	/** The admin setting `webhooksAllowPrivateTargets`. */
	allowPrivateTargets: () => Promise<boolean>;
	allowHosts: ReadonlySet<string>;
	resolve?: Resolver;
	timeoutMs?: number;
	now?: () => Date;
};

function hostOf(endpoint: string): string {
	return new URL(endpoint).hostname
		.toLowerCase()
		.replace(/^\[(.*)\]$/, "$1")
		.replace(/\.$/, "");
}

function vapidHeader(
	config: WebPushConfig,
	endpoint: string,
	now: Date,
): string {
	const jwt = signJwt(
		"ES256",
		{ typ: "JWT" },
		{
			aud: new URL(endpoint).origin,
			exp: Math.floor(now.getTime() / 1000) + VAPID_LIFETIME_S,
			sub: config.subject,
		},
		config.privateKey,
	);
	return `vapid t=${jwt}, k=${config.publicKey}`;
}

function outcomeOf(
	result: Awaited<ReturnType<typeof sendWebhook>>,
	now: Date,
): SendOutcome {
	if (result.ok) return { kind: "sent", statusCode: result.statusCode };
	const { statusCode, error } = result;
	if (statusCode === 404 || statusCode === 410)
		return { kind: "dead", statusCode, code: "gone" };
	if (
		statusCode !== null &&
		(statusCode === 429 || statusCode === 408 || statusCode >= 500)
	) {
		const retryAfterMs = parseRetryAfter(result.retryAfter, now);
		return {
			kind: "retry",
			statusCode,
			code: `http_${statusCode}`,
			...(retryAfterMs !== undefined && { retryAfterMs }),
		};
	}
	if (statusCode !== null)
		return { kind: "failed", statusCode, code: `http_${statusCode}` };
	if (error === "blocked_target" || error === "internal_error")
		return { kind: "failed", statusCode: null, code: error };
	return { kind: "retry", statusCode: null, code: error };
}

export function createWebPushSender(
	config: WebPushConfig,
	options: WebPushOptions,
): PushSender {
	return {
		close() {},
		async send(target: PushTarget, message: PushMessage) {
			const { endpoint, p256dh, auth } = target;
			if (!endpoint || !p256dh || !auth)
				return { kind: "dead", statusCode: null, code: "no_subscription" };

			let body: Buffer;
			try {
				body = encryptWebPush(
					Buffer.from(
						JSON.stringify({
							...message.data,
							title: message.title,
							body: message.body,
						}),
					),
					{ p256dh, auth },
				);
			} catch (error) {
				if (error instanceof WebPushKeyError)
					return { kind: "dead", statusCode: null, code: "bad_keys" };
				if (error instanceof RangeError)
					return { kind: "failed", statusCode: null, code: "too_large" };
				throw error;
			}

			const allowPrivate =
				options.allowHosts.has(hostOf(endpoint)) ||
				(await options.allowPrivateTargets());
			const now = options.now?.() ?? new Date();
			const result = await sendWebhook({
				url: endpoint,
				body,
				allowPrivate,
				resolve: options.resolve,
				timeoutMs: options.timeoutMs,
				headers: {
					Authorization: vapidHeader(config, endpoint, now),
					"Content-Encoding": "aes128gcm",
					"Content-Type": "application/octet-stream",
					TTL: String(message.ttlSeconds),
					Urgency: "normal",
				},
			});
			return outcomeOf(result, now);
		},
	};
}
