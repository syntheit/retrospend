import type { FcmConfig } from "../config";
import { signJwt } from "./jwt";
import { parseRetryAfter } from "./retry-after";
import type { PushMessage, PushSender, SendOutcome } from "./types";

/**
 * Firebase Cloud Messaging, HTTP v1 API. Optional: it runs only when a
 * Google service account is configured, and only for devices that
 * registered an FCM token (a phone with Play services). The service account
 * signs a JWT that Google exchanges for a one-hour access token, cached
 * here until a minute before it ends.
 */

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TIMEOUT_MS = 10_000;
const TOKEN_MARGIN_MS = 60_000;

export type FcmOptions = {
	timeoutMs?: number;
	now?: () => Date;
};

type Failure = { status: number; code: string | null; retryAfterMs?: number };

/** The `errorCode` Google puts in the error details, else its status word. */
async function errorCodeOf(res: Response): Promise<string | null> {
	try {
		const body = (await res.json()) as {
			error?: { status?: unknown; details?: { errorCode?: unknown }[] };
		};
		const detail = body.error?.details?.find(
			(d) => typeof d.errorCode === "string",
		)?.errorCode;
		if (typeof detail === "string") return detail.slice(0, 64);
		return typeof body.error?.status === "string"
			? body.error.status.slice(0, 64)
			: null;
	} catch {
		return null;
	}
}

function outcomeOf({ status, code, retryAfterMs: wait }: Failure): SendOutcome {
	if (status === 404 || (status === 403 && code === "SENDER_ID_MISMATCH"))
		return { kind: "dead", statusCode: status, code: code ?? "unregistered" };
	if (status === 429 || status >= 500)
		return {
			kind: "retry",
			statusCode: status,
			code: code ?? `http_${status}`,
			retryAfterMs: wait,
		};
	return { kind: "failed", statusCode: status, code: code ?? `http_${status}` };
}

export function createFcmSender(
	config: FcmConfig,
	options: FcmOptions = {},
): PushSender {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const clock = () => (options.now?.() ?? new Date()).getTime();
	let access: { token: string; expiresAt: number } | null = null;

	async function accessToken(refresh: boolean): Promise<string> {
		const now = clock();
		if (!refresh && access && access.expiresAt - TOKEN_MARGIN_MS > now)
			return access.token;
		const iat = Math.floor(now / 1000);
		const assertion = signJwt(
			"RS256",
			{ typ: "JWT" },
			{
				iss: config.clientEmail,
				scope: SCOPE,
				aud: config.tokenUrl,
				iat,
				exp: iat + 3600,
			},
			config.privateKey,
		);
		const res = await fetch(config.tokenUrl, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
				assertion,
			}),
			redirect: "error",
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!res.ok) throw new TokenError(res.status);
		const body = (await res.json()) as {
			access_token?: unknown;
			expires_in?: unknown;
		};
		if (typeof body.access_token !== "string") throw new TokenError(0);
		const seconds = Number(body.expires_in);
		access = {
			token: body.access_token,
			expiresAt: now + (Number.isFinite(seconds) ? seconds : 3600) * 1000,
		};
		return access.token;
	}

	async function post(
		token: string,
		deviceToken: string,
		message: PushMessage,
	): Promise<Response> {
		return fetch(
			`${config.apiBaseUrl}/v1/projects/${encodeURIComponent(config.projectId)}/messages:send`,
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					message: {
						token: deviceToken,
						notification: { title: message.title, body: message.body },
						data: { retrospend: JSON.stringify(message.data) },
						android: {
							priority: "HIGH",
							ttl: `${message.ttlSeconds}s`,
							notification: { channel_id: message.channel },
						},
						apns: { payload: { aps: { "thread-id": message.channel } } },
					},
				}),
				redirect: "error",
				signal: AbortSignal.timeout(timeoutMs),
			},
		);
	}

	return {
		close() {},
		async send(target, message) {
			if (!target.token)
				return { kind: "dead", statusCode: null, code: "bad_token" };
			try {
				let res = await post(await accessToken(false), target.token, message);
				if (res.status === 401)
					res = await post(await accessToken(true), target.token, message);
				if (res.ok) return { kind: "sent", statusCode: res.status };
				return outcomeOf({
					status: res.status,
					code: await errorCodeOf(res),
					retryAfterMs: parseRetryAfter(
						res.headers.get("retry-after"),
						new Date(clock()),
					),
				});
			} catch (error) {
				if (error instanceof TokenError)
					// Google refused our own credentials: not the device's fault.
					return error.status >= 500 || error.status === 0
						? { kind: "retry", statusCode: null, code: "token_unavailable" }
						: {
								kind: "failed",
								statusCode: error.status,
								code: "bad_credentials",
							};
				return { kind: "retry", statusCode: null, code: "connection_error" };
			}
		},
	};
}

class TokenError extends Error {
	constructor(readonly status: number) {
		super("FCM access token request failed");
	}
}
