/**
 * The webhook worker's fairness on Postgres. A webhook URL is an address the
 * user chose, so one that never answers must not hold every send slot: the
 * worker sends to a few places per person and per domain at a time, and
 * picks its batch evenly across people. Receivers are a local server that
 * stays busy a moment; names resolve to it through the injected resolver.
 */
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { encryptSecret } from "./secret";
import { PER_HOST_ATTEMPTS, PER_USER_ATTEMPTS, PER_USER_BATCH } from "./schedule";
import { processDueDeliveries } from "./worker";

const NOW = new Date("2026-10-26T15:00:00Z");

describe("webhook worker limits", () => {
	let server: Server;
	let port: number;
	let running = 0;
	let peak = 0;
	let hits: string[] = [];
	const busyMs = 40;

	beforeAll(async () => {
		server = createServer((req, res) => {
			running += 1;
			peak = Math.max(peak, running);
			hits.push(String(req.headers.host).split(":")[0] as string);
			setTimeout(() => {
				running -= 1;
				res.statusCode = 204;
				res.end();
			}, busyMs);
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		port = (server.address() as AddressInfo).port;
	});

	afterAll(async () => {
		// Pending leftovers would be sent by the next file's sweep.
		await adminDb.webhookDelivery.deleteMany({});
		await new Promise<void>((r) => server.close(() => r()));
	});

	beforeEach(async () => {
		// The worker takes any due delivery, other files' leftovers included.
		await adminDb.webhookDelivery.deleteMany({});
		running = 0;
		peak = 0;
		hits = [];
	});

	const sweep = () =>
		processDueDeliveries({
			now: NOW,
			allowPrivate: true,
			resolve: async () => ["127.0.0.1"],
		});

	async function hook(userId: string, host: string) {
		return adminDb.webhook.create({
			data: {
				id: randomUUID(),
				userId,
				name: host,
				url: `http://${host}:${port}/hook`,
				eventTypes: [],
				secretCipher: encryptSecret("whsec_test"),
				secretStart: "whsec_test",
			},
		});
	}

	async function pending(
		userId: string,
		webhookId: string,
		at: Date = NOW,
		count = 1,
	) {
		const ids: string[] = [];
		for (let n = 0; n < count; n++) {
			const event = await adminDb.apiEvent.create({
				data: {
					userId,
					actorUserId: userId,
					type: "expense.created",
					payload: { ids: {}, amounts: [], truncated: false },
					fannedOutAt: at,
				},
			});
			const row = await adminDb.webhookDelivery.create({
				data: {
					webhookId,
					userId,
					eventId: event.id,
					eventType: "expense.created",
					nextAttemptAt: at,
				},
			});
			ids.push(row.id);
		}
		return ids;
	}

	it("sends to at most two of one person's places at a time", async () => {
		const { user } = await createTestUser();
		for (let n = 0; n < 6; n++)
			await pending(user.id, (await hook(user.id, `h${n}.site${n}.test`)).id);

		expect(await sweep()).toBe(6);

		expect(hits).toHaveLength(6);
		expect(peak).toBe(PER_USER_ATTEMPTS);
	});

	it("sends to at most two hosts of one domain at a time, whoever owns them", async () => {
		for (let u = 0; u < 3; u++) {
			const { user } = await createTestUser();
			for (let n = 0; n < 2; n++)
				await pending(user.id, (await hook(user.id, `s${u}${n}.evil.test`)).id);
		}

		expect(await sweep()).toBe(6);

		expect(hits).toHaveLength(6);
		expect(peak).toBe(PER_HOST_ATTEMPTS);
	});

	it("picks fairly: a person's backlog does not make everyone else wait for all of it", async () => {
		const { user: busy } = await createTestUser();
		const { user: other } = await createTestUser();
		const busyHook = await hook(busy.id, "busy.one.test");
		const otherHook = await hook(other.id, "other.two.test");
		const old = new Date(NOW.getTime() - 3600_000);
		await pending(busy.id, busyHook.id, old, 60);
		const [late] = await pending(other.id, otherHook.id, NOW);

		expect(await sweep()).toBe(61);

		// Her one delivery goes out among the first batch, not after his 60.
		expect(hits.indexOf("other.two.test")).toBeGreaterThanOrEqual(0);
		expect(hits.indexOf("other.two.test")).toBeLessThan(PER_USER_BATCH);
		const row = await adminDb.webhookDelivery.findUniqueOrThrow({
			where: { id: late as string },
		});
		expect(row.status).toBe("SUCCEEDED");
	});
});
