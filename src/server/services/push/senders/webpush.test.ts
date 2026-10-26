import { createPublicKey } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { loadPushConfig, type WebPushConfig } from "../config";
import {
	decodeJwt,
	decryptWebPush,
	mockHttp,
	newSubscription,
	newVapidEnv,
	verifyJwt,
} from "../test-helpers";
import type { PushMessage, PushTarget } from "./types";
import { createWebPushSender } from "./webpush";

const vapidEnv = newVapidEnv();
const config = loadPushConfig(vapidEnv).webPush as WebPushConfig;
const message: PushMessage = {
	title: "Payment recorded",
	body: "A payment of USD 12.50 was recorded",
	channel: "payments",
	data: {
		v: 1,
		type: "payment.recorded",
		entity: { type: "payment", id: "p1" },
	},
	ttlSeconds: 3600,
};

let closeServer: (() => Promise<void>) | undefined;
afterEach(async () => {
	await closeServer?.();
	closeServer = undefined;
});

function targetFor(
	url: string,
	sub: ReturnType<typeof newSubscription>,
): PushTarget {
	return {
		id: "d1",
		transport: "UNIFIEDPUSH",
		token: null,
		endpoint: `${url}/push/abc`,
		p256dh: sub.p256dh,
		auth: sub.auth,
		apnsSandbox: false,
	};
}

describe("Web Push sender", () => {
	it("sends an encrypted payload the device can read, signed with VAPID", async () => {
		const sub = newSubscription();
		const server = await mockHttp(() => ({ status: 201 }));
		closeServer = server.close;
		const sender = createWebPushSender(config, {
			allowPrivateTargets: async () => true,
			allowHosts: new Set(),
		});

		const out = await sender.send(targetFor(server.url, sub), message);

		expect(out).toEqual({ kind: "sent", statusCode: 201 });
		const req = server.seen[0];
		expect(req?.method).toBe("POST");
		expect(req?.url).toBe("/push/abc");
		expect(req?.headers["content-encoding"]).toBe("aes128gcm");
		expect(req?.headers.ttl).toBe("3600");
		const plain = JSON.parse(
			decryptWebPush(req?.body ?? Buffer.alloc(0), sub).toString(),
		);
		expect(plain).toEqual({
			...message.data,
			title: message.title,
			body: message.body,
		});

		const auth = String(req?.headers.authorization);
		const [, jwt, key] = /^vapid t=(\S+), k=(\S+)$/.exec(auth) ?? [];
		expect(key).toBe(vapidEnv.VAPID_PUBLIC_KEY);
		const { header, claims } = decodeJwt(jwt ?? "");
		expect(header).toMatchObject({ typ: "JWT", alg: "ES256" });
		expect(claims.aud).toBe(server.url);
		expect(claims.sub).toBe("mailto:ops@example.test");
		expect(claims.exp * 1000 - Date.now()).toBeLessThanOrEqual(
			24 * 3600 * 1000,
		);
		const publicKey = createPublicKey({
			format: "jwk",
			key: {
				kty: "EC",
				crv: "P-256",
				x: Buffer.from(key ?? "", "base64url")
					.subarray(1, 33)
					.toString("base64url"),
				y: Buffer.from(key ?? "", "base64url")
					.subarray(33, 65)
					.toString("base64url"),
			},
		});
		expect(verifyJwt(jwt ?? "", "ES256", publicKey)).toBe(true);
	});

	it("maps the push service's answers", async () => {
		const sub = newSubscription();
		let status = 201;
		const server = await mockHttp(() => ({ status }));
		closeServer = server.close;
		const sender = createWebPushSender(config, {
			allowPrivateTargets: async () => true,
			allowHosts: new Set(),
		});
		const target = targetFor(server.url, sub);
		const run = async (s: number) => {
			status = s;
			return sender.send(target, message);
		};
		expect(await run(410)).toMatchObject({ kind: "dead" });
		expect(await run(404)).toMatchObject({ kind: "dead" });
		expect(await run(429)).toMatchObject({ kind: "retry", statusCode: 429 });
		expect(await run(503)).toMatchObject({ kind: "retry", statusCode: 503 });
		expect(await run(413)).toMatchObject({ kind: "failed", statusCode: 413 });
		expect(await run(401)).toMatchObject({ kind: "failed", statusCode: 401 });
	});

	it("passes on how long the push service asked to wait", async () => {
		const sub = newSubscription();
		let reply: { status: number; headers?: Record<string, string> } = {
			status: 429,
		};
		const server = await mockHttp(() => reply);
		closeServer = server.close;
		const now = new Date("2026-10-26T15:00:00Z");
		const sender = createWebPushSender(config, {
			allowPrivateTargets: async () => true,
			allowHosts: new Set(),
			now: () => now,
		});
		const run = (status: number, retryAfter?: string) => {
			reply = {
				status,
				headers: retryAfter ? { "Retry-After": retryAfter } : undefined,
			};
			return sender.send(targetFor(server.url, sub), message);
		};

		expect(await run(429, "120")).toEqual({
			kind: "retry",
			statusCode: 429,
			code: "http_429",
			retryAfterMs: 120_000,
		});
		expect(await run(503, "Mon, 26 Oct 2026 15:10:00 GMT")).toMatchObject({
			kind: "retry",
			statusCode: 503,
			retryAfterMs: 600_000,
		});
		// No header, or one that means nothing: the scheduler's own backoff.
		expect(await run(429)).not.toHaveProperty("retryAfterMs");
		expect(await run(503, "later")).not.toHaveProperty("retryAfterMs");
		// A hint on an answer that is not retried changes nothing.
		expect(await run(413, "120")).toEqual({
			kind: "failed",
			statusCode: 413,
			code: "http_413",
		});
	});

	it("drops a subscription whose keys cannot work", async () => {
		const sender = createWebPushSender(config, {
			allowPrivateTargets: async () => true,
			allowHosts: new Set(),
		});
		const target = targetFor("http://127.0.0.1:9", newSubscription());
		expect(
			await sender.send({ ...target, auth: "AAAA" }, message),
		).toMatchObject({ kind: "dead", code: "bad_keys" });
		expect(
			await sender.send({ ...target, endpoint: null }, message),
		).toMatchObject({ kind: "dead" });
	});

	it("does not connect to a private endpoint unless allowed", async () => {
		const sub = newSubscription();
		const server = await mockHttp(() => ({ status: 201 }));
		closeServer = server.close;
		const target = targetFor(server.url, sub);

		const refusing = createWebPushSender(config, {
			allowPrivateTargets: async () => false,
			allowHosts: new Set(),
		});
		expect(await refusing.send(target, message)).toMatchObject({
			kind: "failed",
			code: "blocked_target",
		});
		expect(server.seen).toHaveLength(0);

		// A name that resolves to a private address is refused too.
		const named = createWebPushSender(config, {
			allowPrivateTargets: async () => false,
			allowHosts: new Set(),
			resolve: async () => ["10.0.0.5"],
		});
		expect(
			await named.send(
				{ ...target, endpoint: "https://push.example.test/abc" },
				message,
			),
		).toMatchObject({ kind: "failed", code: "blocked_target" });

		// The operator's list lets one host through, and the admin setting all.
		const listed = createWebPushSender(config, {
			allowPrivateTargets: async () => false,
			allowHosts: new Set(["127.0.0.1"]),
		});
		expect(await listed.send(target, message)).toMatchObject({ kind: "sent" });
		const admin = createWebPushSender(config, {
			allowPrivateTargets: async () => true,
			allowHosts: new Set(),
		});
		expect(await admin.send(target, message)).toMatchObject({ kind: "sent" });
		expect(server.seen).toHaveLength(2);
	});

	it("retries when the endpoint cannot be reached", async () => {
		const server = await mockHttp(() => ({ status: 201 }));
		const url = server.url;
		await server.close();
		const sender = createWebPushSender(config, {
			allowPrivateTargets: async () => true,
			allowHosts: new Set(),
		});
		expect(
			await sender.send(targetFor(url, newSubscription()), message),
		).toMatchObject({ kind: "retry", code: "connection_refused" });
	});

	it("does not follow a redirect", async () => {
		const target = await mockHttp(() => ({ status: 201 }));
		const redirect = await mockHttp(() => ({
			status: 307,
			headers: { location: `${target.url}/elsewhere` },
		}));
		closeServer = async () => {
			await target.close();
			await redirect.close();
		};
		const sender = createWebPushSender(config, {
			allowPrivateTargets: async () => true,
			allowHosts: new Set(),
		});
		expect(
			await sender.send(targetFor(redirect.url, newSubscription()), message),
		).toMatchObject({ kind: "failed", statusCode: 307 });
		expect(target.seen).toHaveLength(0);
	});
});
