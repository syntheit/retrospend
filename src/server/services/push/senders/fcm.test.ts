import { afterEach, describe, expect, it } from "vitest";
import { type FcmConfig, loadPushConfig } from "../config";
import {
	decodeJwt,
	type MockReply,
	mockHttp,
	newServiceAccount,
	type Seen,
	verifyJwt,
} from "../test-helpers";
import { createFcmSender } from "./fcm";
import type { PushMessage, PushTarget } from "./types";

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
const target: PushTarget = {
	id: "d1",
	transport: "FCM",
	token: "device-token-1",
	endpoint: null,
	p256dh: null,
	auth: null,
	apnsSandbox: false,
};

const account = newServiceAccount();
let closeServer: (() => Promise<void>) | undefined;
afterEach(async () => {
	await closeServer?.();
	closeServer = undefined;
});

/** One mock for both Google hosts: /token hands out tokens, /v1/... takes messages. */
async function mockGoogle(send: (seen: Seen, n: number) => MockReply) {
	let sends = 0;
	let tokens = 0;
	const server = await mockHttp((seen) => {
		if (seen.url === "/token")
			return {
				status: 200,
				body: JSON.stringify({
					access_token: `access-${++tokens}`,
					expires_in: 3600,
				}),
			};
		return send(seen, ++sends);
	});
	closeServer = server.close;
	const config = loadPushConfig({ FCM_SERVICE_ACCOUNT: account.json }).fcm;
	if (!config) throw new Error("FCM config did not load");
	return {
		server,
		config: {
			...config,
			tokenUrl: `${server.url}/token`,
			apiBaseUrl: server.url,
		} satisfies FcmConfig,
	};
}

describe("FCM sender", () => {
	it("gets an access token with a signed assertion, then sends the message", async () => {
		const { server, config } = await mockGoogle(() => ({
			status: 200,
			body: "{}",
		}));
		const sender = createFcmSender(config);

		expect(await sender.send(target, message)).toEqual({
			kind: "sent",
			statusCode: 200,
		});

		const tokenRequest = server.seen[0];
		const form = new URLSearchParams(tokenRequest?.body.toString());
		expect(form.get("grant_type")).toBe(
			"urn:ietf:params:oauth:grant-type:jwt-bearer",
		);
		const assertion = form.get("assertion") ?? "";
		expect(verifyJwt(assertion, "RS256", account.publicKey)).toBe(true);
		expect(decodeJwt(assertion).claims).toMatchObject({
			iss: "push@demo-project.iam.example.test",
			scope: "https://www.googleapis.com/auth/firebase.messaging",
			aud: config.tokenUrl,
		});

		const send = server.seen[1];
		expect(send?.url).toBe("/v1/projects/demo-project/messages:send");
		expect(send?.headers.authorization).toBe("Bearer access-1");
		expect(JSON.parse(send?.body.toString() ?? "{}")).toEqual({
			message: {
				token: "device-token-1",
				notification: { title: message.title, body: message.body },
				data: { retrospend: JSON.stringify(message.data) },
				android: {
					priority: "HIGH",
					ttl: "3600s",
					notification: { channel_id: "payments" },
				},
				apns: { payload: { aps: { "thread-id": "payments" } } },
			},
		});
	});

	it("keeps the access token until it nears its end", async () => {
		const { server, config } = await mockGoogle(() => ({
			status: 200,
			body: "{}",
		}));
		let clock = new Date("2026-10-26T10:00:00Z");
		const sender = createFcmSender(config, { now: () => clock });

		await sender.send(target, message);
		await sender.send(target, message);
		clock = new Date("2026-10-26T10:59:30Z");
		await sender.send(target, message);

		const authorizations = server.seen
			.filter((s) => s.url !== "/token")
			.map((s) => s.headers.authorization);
		expect(authorizations).toEqual([
			"Bearer access-1",
			"Bearer access-1",
			"Bearer access-2",
		]);
	});

	it("asks for a new token once when Google answers 401", async () => {
		const { server, config } = await mockGoogle((_seen, n) =>
			n === 1 ? { status: 401, body: "{}" } : { status: 200, body: "{}" },
		);
		const sender = createFcmSender(config);

		expect(await sender.send(target, message)).toMatchObject({ kind: "sent" });
		const sends = server.seen.filter((s) => s.url !== "/token");
		expect(sends.map((s) => s.headers.authorization)).toEqual([
			"Bearer access-1",
			"Bearer access-2",
		]);
	});

	it("maps Google's answers", async () => {
		let reply: MockReply = { status: 200 };
		const { config } = await mockGoogle(() => reply);
		const sender = createFcmSender(config);
		const run = async (status: number, errorCode?: string, headers = {}) => {
			reply = {
				status,
				headers,
				body: JSON.stringify(
					errorCode ? { error: { status: "X", details: [{ errorCode }] } } : {},
				),
			};
			return sender.send(target, message);
		};

		expect(await run(404, "UNREGISTERED")).toMatchObject({ kind: "dead" });
		expect(await run(403, "SENDER_ID_MISMATCH")).toMatchObject({
			kind: "dead",
		});
		expect(await run(403, "PERMISSION_DENIED")).toMatchObject({
			kind: "failed",
		});
		expect(await run(400, "INVALID_ARGUMENT")).toMatchObject({
			kind: "failed",
			code: "INVALID_ARGUMENT",
		});
		expect(await run(503, "UNAVAILABLE")).toMatchObject({ kind: "retry" });
		expect(await run(429, "QUOTA_EXCEEDED", { "retry-after": "120" })).toEqual({
			kind: "retry",
			statusCode: 429,
			code: "QUOTA_EXCEEDED",
			retryAfterMs: 120_000,
		});
	});

	it("does not blame the device when Google refuses our credentials", async () => {
		const server = await mockHttp(() => ({ status: 400, body: "{}" }));
		closeServer = server.close;
		const config = loadPushConfig({ FCM_SERVICE_ACCOUNT: account.json }).fcm;
		if (!config) throw new Error("FCM config did not load");
		const sender = createFcmSender({
			...config,
			tokenUrl: `${server.url}/token`,
			apiBaseUrl: server.url,
		});
		expect(await sender.send(target, message)).toMatchObject({
			kind: "failed",
			code: "bad_credentials",
		});
	});

	it("retries when Google cannot be reached", async () => {
		const { config, server } = await mockGoogle(() => ({ status: 200 }));
		await server.close();
		const sender = createFcmSender(config);
		expect(await sender.send(target, message)).toMatchObject({ kind: "retry" });
	});
});
