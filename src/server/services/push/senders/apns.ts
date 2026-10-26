import { type ClientHttp2Session, connect, constants } from "node:http2";
import type { ApnsConfig } from "../config";
import { signJwt } from "./jwt";
import type { PushMessage, PushSender, PushTarget, SendOutcome } from "./types";

/**
 * APNs over HTTP/2 with token-based auth (a .p8 key signs a short-lived
 * provider token). One connection per host (production and sandbox are
 * different hosts, picked by how the device registered) is kept open
 * between sends and closed with the sender.
 *
 * Apple asks providers to reuse a token for up to an hour and not to make
 * a new one more than once every 20 minutes, so the token is cached for 50
 * minutes.
 */

const TOKEN_LIFETIME_MS = 50 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REASON_BYTES = 2048;
const HEX = /^[0-9a-f]{32,200}$/i;

export type ApnsOptions = {
	timeoutMs?: number;
	now?: () => Date;
};

type Answer = { status: number; reason: string | null };

function outcomeOf({ status, reason }: Answer): SendOutcome {
	if (status === 200) return { kind: "sent", statusCode: 200 };
	if (status === 410 || (status === 400 && reason === "BadDeviceToken"))
		return { kind: "dead", statusCode: status, code: reason ?? "unregistered" };
	if (status === 400 && reason === "DeviceTokenNotForTopic")
		return { kind: "dead", statusCode: status, code: reason };
	if (status === 429 || status >= 500)
		return {
			kind: "retry",
			statusCode: status,
			code: reason ?? `http_${status}`,
		};
	return {
		kind: "failed",
		statusCode: status,
		code: reason ?? `http_${status}`,
	};
}

export function createApnsSender(
	config: ApnsConfig,
	options: ApnsOptions = {},
): PushSender {
	const sessions = new Map<string, ClientHttp2Session>();
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	let token: { jwt: string; issuedAt: number } | null = null;

	const clock = () => (options.now?.() ?? new Date()).getTime();

	function providerToken(refresh: boolean): string {
		const now = clock();
		if (refresh || !token || now - token.issuedAt > TOKEN_LIFETIME_MS)
			token = {
				issuedAt: now,
				jwt: signJwt(
					"ES256",
					{ kid: config.keyId },
					{ iss: config.teamId, iat: Math.floor(now / 1000) },
					config.privateKey,
				),
			};
		return token.jwt;
	}

	function sessionFor(url: string): ClientHttp2Session {
		const open = sessions.get(url);
		if (open && !open.closed && !open.destroyed) return open;
		const session = connect(url);
		const forget = () => {
			if (sessions.get(url) === session) sessions.delete(url);
		};
		session.on("error", forget);
		session.on("close", forget);
		session.on("goaway", forget);
		sessions.set(url, session);
		return session;
	}

	function post(
		url: string,
		path: string,
		headers: Record<string, string>,
		body: string,
	): Promise<Answer> {
		return new Promise((resolve, reject) => {
			const session = sessionFor(url);
			const req = session.request({
				":method": "POST",
				":path": path,
				...headers,
			});
			let status = 0;
			const chunks: Buffer[] = [];
			let size = 0;
			req.setTimeout(timeoutMs, () => {
				req.close(constants.NGHTTP2_CANCEL);
				reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
			});
			req.on("response", (h) => {
				status = Number(h[":status"] ?? 0);
			});
			req.on("data", (chunk: Buffer) => {
				size += chunk.length;
				if (size <= MAX_REASON_BYTES) chunks.push(chunk);
			});
			req.on("end", () => {
				let reason: string | null = null;
				try {
					const parsed = JSON.parse(Buffer.concat(chunks).toString()) as {
						reason?: unknown;
					};
					if (typeof parsed.reason === "string")
						reason = parsed.reason.slice(0, 64);
				} catch {
					// Success has no body; an error body that is not JSON has no reason.
				}
				resolve({ status, reason });
			});
			req.on("error", reject);
			req.end(body);
		});
	}

	async function attempt(
		target: PushTarget,
		message: PushMessage,
		refresh: boolean,
	): Promise<Answer> {
		const base = target.apnsSandbox ? config.sandboxUrl : config.productionUrl;
		return post(
			base,
			`/3/device/${target.token}`,
			{
				authorization: `bearer ${providerToken(refresh)}`,
				"apns-topic": config.bundleId,
				"apns-push-type": "alert",
				"apns-priority": "10",
				"apns-expiration": String(
					Math.floor(clock() / 1000) + message.ttlSeconds,
				),
				"content-type": "application/json",
			},
			JSON.stringify({
				aps: {
					alert: { title: message.title, body: message.body },
					sound: "default",
					"thread-id": message.channel,
					category: message.channel,
				},
				retrospend: message.data,
			}),
		);
	}

	return {
		close() {
			for (const session of sessions.values()) session.close();
			sessions.clear();
		},
		async send(target, message) {
			// The token goes into the request path: only hex may.
			if (!target.token || !HEX.test(target.token))
				return { kind: "dead", statusCode: null, code: "bad_token" };
			try {
				let answer = await attempt(target, message, false);
				if (answer.status === 403 && answer.reason === "ExpiredProviderToken")
					answer = await attempt(target, message, true);
				return outcomeOf(answer);
			} catch (error) {
				const code = String((error as { code?: unknown }).code ?? "");
				return {
					kind: "retry",
					statusCode: null,
					code: code === "ETIMEDOUT" ? "timeout" : "connection_error",
				};
			}
		},
	};
}
