import { createServer, type Http2Server } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { type ApnsConfig, loadPushConfig } from "../config";
import { decodeJwt, newApnsKey, verifyJwt } from "../test-helpers";
import { createApnsSender } from "./apns";
import type { PushMessage, PushTarget } from "./types";

type Seen = {
	headers: Record<string, unknown>;
	body: string;
};

const TOKEN = "a".repeat(64);
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
const target = (over: Partial<PushTarget> = {}): PushTarget => ({
	id: "d1",
	transport: "APNS",
	token: TOKEN,
	endpoint: null,
	p256dh: null,
	auth: null,
	apnsSandbox: false,
	...over,
});

const servers: Http2Server[] = [];
async function mockApns(
	reply: (seen: Seen, n: number) => { status: number; reason?: string },
) {
	const seen: Seen[] = [];
	const server = createServer();
	servers.push(server);
	server.on("stream", (stream, headers) => {
		const chunks: Buffer[] = [];
		stream.on("data", (c: Buffer) => chunks.push(c));
		stream.on("end", () => {
			const entry = { headers, body: Buffer.concat(chunks).toString() };
			seen.push(entry);
			const out = reply(entry, seen.length);
			stream.respond({ ":status": out.status });
			stream.end(out.reason ? JSON.stringify({ reason: out.reason }) : "");
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return { url, seen };
}

const key = newApnsKey();
function configFor(production: string, sandbox = production): ApnsConfig {
	const config = loadPushConfig({
		APNS_KEY_ID: "KEY1234567",
		APNS_TEAM_ID: "TEAM123456",
		APNS_BUNDLE_ID: "io.example.retrospend",
		APNS_KEY: key.pem,
	}).apns;
	if (!config) throw new Error("APNs config did not load");
	return { ...config, productionUrl: production, sandboxUrl: sandbox };
}

afterEach(async () => {
	await Promise.all(
		servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))),
	);
});

describe("APNs sender", () => {
	it("posts the alert over HTTP/2 with a signed provider token", async () => {
		const apns = await mockApns(() => ({ status: 200 }));
		const sender = createApnsSender(configFor(apns.url));

		const out = await sender.send(target(), message);
		sender.close();

		expect(out).toEqual({ kind: "sent", statusCode: 200 });
		const req = apns.seen[0];
		expect(req?.headers[":method"]).toBe("POST");
		expect(req?.headers[":path"]).toBe(`/3/device/${TOKEN}`);
		expect(req?.headers["apns-topic"]).toBe("io.example.retrospend");
		expect(req?.headers["apns-push-type"]).toBe("alert");
		const bearer = String(req?.headers.authorization);
		expect(bearer.startsWith("bearer ")).toBe(true);
		const jwt = bearer.slice(7);
		const { header, claims } = decodeJwt(jwt);
		expect(header).toEqual({ kid: "KEY1234567", alg: "ES256" });
		expect(claims.iss).toBe("TEAM123456");
		expect(verifyJwt(jwt, "ES256", key.publicKey)).toBe(true);
		expect(JSON.parse(req?.body ?? "{}")).toEqual({
			aps: {
				alert: { title: message.title, body: message.body },
				sound: "default",
				"thread-id": "payments",
				category: "payments",
			},
			retrospend: message.data,
		});
	});

	it("uses the sandbox host for a device that registered with it", async () => {
		const production = await mockApns(() => ({ status: 200 }));
		const sandbox = await mockApns(() => ({ status: 200 }));
		const sender = createApnsSender(configFor(production.url, sandbox.url));

		await sender.send(target({ apnsSandbox: true }), message);
		await sender.send(target({ apnsSandbox: false }), message);
		sender.close();

		expect(sandbox.seen).toHaveLength(1);
		expect(production.seen).toHaveLength(1);
	});

	it("reuses the provider token for a while, then makes a new one", async () => {
		const apns = await mockApns(() => ({ status: 200 }));
		let clock = new Date("2026-10-26T10:00:00Z");
		const sender = createApnsSender(configFor(apns.url), { now: () => clock });

		await sender.send(target(), message);
		clock = new Date("2026-10-26T10:30:00Z");
		await sender.send(target(), message);
		clock = new Date("2026-10-26T10:51:00Z");
		await sender.send(target(), message);
		sender.close();

		const tokens = apns.seen.map((s) => s.headers.authorization);
		expect(tokens[0]).toBe(tokens[1]);
		expect(tokens[2]).not.toBe(tokens[0]);
	});

	it("maps Apple's answers", async () => {
		let answer: { status: number; reason?: string } = { status: 200 };
		const apns = await mockApns(() => answer);
		const sender = createApnsSender(configFor(apns.url));
		const run = async (status: number, reason?: string) => {
			answer = { status, reason };
			return sender.send(target(), message);
		};

		expect(await run(410, "Unregistered")).toMatchObject({ kind: "dead" });
		expect(await run(400, "BadDeviceToken")).toMatchObject({ kind: "dead" });
		expect(await run(400, "DeviceTokenNotForTopic")).toMatchObject({
			kind: "dead",
		});
		expect(await run(400, "PayloadTooLarge")).toMatchObject({
			kind: "failed",
			code: "PayloadTooLarge",
		});
		expect(await run(403, "InvalidProviderToken")).toMatchObject({
			kind: "failed",
		});
		expect(await run(429, "TooManyRequests")).toMatchObject({ kind: "retry" });
		expect(await run(503, "ServiceUnavailable")).toMatchObject({
			kind: "retry",
		});
		sender.close();
	});

	it("makes a new token once when Apple says the old one expired", async () => {
		const apns = await mockApns((_seen, n) =>
			n === 1
				? { status: 403, reason: "ExpiredProviderToken" }
				: { status: 200 },
		);
		const sender = createApnsSender(configFor(apns.url));

		expect(await sender.send(target(), message)).toMatchObject({
			kind: "sent",
		});
		sender.close();
		expect(apns.seen).toHaveLength(2);
	});

	it("never puts anything but hex into the request path", async () => {
		const apns = await mockApns(() => ({ status: 200 }));
		const sender = createApnsSender(configFor(apns.url));

		expect(
			await sender.send(target({ token: "../v1/../admin" }), message),
		).toMatchObject({ kind: "dead", code: "bad_token" });
		expect(await sender.send(target({ token: null }), message)).toMatchObject({
			kind: "dead",
		});
		sender.close();
		expect(apns.seen).toHaveLength(0);
	});

	it("retries when Apple cannot be reached", async () => {
		const apns = await mockApns(() => ({ status: 200 }));
		await new Promise<void>((r) => servers[0]?.close(() => r()));
		const sender = createApnsSender(configFor(apns.url), { timeoutMs: 2000 });

		expect(await sender.send(target(), message)).toMatchObject({
			kind: "retry",
			statusCode: null,
		});
		sender.close();
	});
});
