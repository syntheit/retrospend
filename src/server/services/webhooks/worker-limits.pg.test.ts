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
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import {
	PER_HOST_ATTEMPTS,
	PER_USER_ATTEMPTS,
	PER_USER_BATCH,
} from "./schedule";
import { encryptSecret } from "./secret";
import { processDueDeliveries, runWebhookWorker } from "./worker";

const NOW = new Date("2026-10-26T15:00:00Z");

describe("webhook worker limits", () => {
	let server: Server;
	let port: number;
	let running = 0;
	let peak = 0;
	let hits: string[] = [];
	/** When each answer went out, by host name. */
	let answered: { host: string; at: number }[] = [];
	const busyMs = 40;
	const slowMs = 400;

	beforeAll(async () => {
		server = createServer((req, res) => {
			running += 1;
			peak = Math.max(peak, running);
			const host = String(req.headers.host).split(":")[0] as string;
			hits.push(host);
			// A host named slow* is the receiver that takes its time.
			setTimeout(
				() => {
					running -= 1;
					answered.push({ host, at: Date.now() });
					res.statusCode = 204;
					res.end();
				},
				host.startsWith("slow") ? slowMs : busyMs,
			);
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
		answered = [];
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

	it("sends to at most two of one host at a time, whoever owns the webhooks", async () => {
		for (let u = 0; u < 3; u++) {
			const { user } = await createTestUser();
			for (let n = 0; n < 2; n++)
				await pending(user.id, (await hook(user.id, "shared.evil.test")).id);
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

	describe("a sweep is not held by one person's slow receivers", () => {
		const past = () => new Date(Date.now() - 1000);
		const real = () =>
			({
				allowPrivate: true,
				resolve: async () => ["127.0.0.1"],
			}) as const;

		it("serves everyone else and a fresh event while ten slow deliveries wait their turns", async () => {
			const { user: slow } = await createTestUser();
			for (let n = 0; n < 10; n++)
				await pending(
					slow.id,
					(await hook(slow.id, `slow${n}.site.test`)).id,
					past(),
				);
			for (let n = 0; n < 40; n++) {
				const { user } = await createTestUser();
				await pending(
					user.id,
					(await hook(user.id, `fast${n}.site.test`)).id,
					past(),
				);
			}
			// An event that is written while the sweep runs.
			const { user: late } = await createTestUser();
			const lateHook = await hook(late.id, "late.site.test");
			const writeLate = setTimeout(() => {
				adminDb.apiEvent
					.create({
						data: {
							userId: late.id,
							actorUserId: late.id,
							type: "expense.created",
							payload: { ids: {}, amounts: [], truncated: false },
						},
					})
					.catch(() => undefined);
			}, 100);

			const started = Date.now();
			await runWebhookWorker(real());
			clearTimeout(writeLate);

			const fast = answered.filter((a) => a.host.startsWith("fast"));
			const slows = answered.filter((a) => a.host.startsWith("slow"));
			expect(fast).toHaveLength(40);
			expect(slows).toHaveLength(10);
			// Two slow ones at a time, 400 ms each: five rounds, two seconds. All
			// the fast ones were answered long before the last slow one.
			const lastSlow = Math.max(...slows.map((a) => a.at));
			expect(Math.max(...fast.map((a) => a.at))).toBeLessThan(lastSlow - 500);
			expect(lastSlow - started).toBeGreaterThanOrEqual(1500);
			// The fresh event was fanned out and delivered within the same sweep.
			expect(
				await adminDb.webhookDelivery.count({
					where: { webhookId: lateHook.id, status: "SUCCEEDED" },
				}),
			).toBe(1);
			expect(answered.some((a) => a.host === "late.site.test")).toBe(true);
		}, 30_000);

		it("stops starting attempts at the budget and leaves the rest for the next sweep", async () => {
			const { user } = await createTestUser();
			const ids: string[] = [];
			for (let n = 0; n < 6; n++)
				ids.push(
					...(await pending(
						user.id,
						(
							await hook(user.id, `slow${n}.budget.test`)
						).id,
						past(),
					)),
				);
			const tried = await processDueDeliveries({ ...real(), budgetMs: 100 });
			// Two at a time: the first two start; the budget ends before more do.
			expect(tried).toBe(2);
			const left = await adminDb.webhookDelivery.count({
				where: { id: { in: ids }, status: "PENDING", attempts: 0 },
			});
			expect(left).toBe(4);
			// The next sweep takes them.
			expect(await processDueDeliveries(real())).toBe(4);
		}, 30_000);

		it("still sends what is due when the fan-out fails, and says so", async () => {
			const { user } = await createTestUser();
			const [id] = await pending(
				user.id,
				(await hook(user.id, "ok.site.test")).id,
				past(),
			);
			const logged = vi.spyOn(console, "error").mockImplementation(() => {});
			try {
				const out = await runWebhookWorker({
					...real(),
					fanOut: async () => {
						throw new Error("fan-out broke");
					},
				});
				expect(out.attempted).toBe(1);
				expect(logged).toHaveBeenCalledWith(
					"Webhook fan-out failed:",
					expect.any(Error),
				);
			} finally {
				logged.mockRestore();
			}
			const row = await adminDb.webhookDelivery.findUniqueOrThrow({
				where: { id: id as string },
			});
			expect(row.status).toBe("SUCCEEDED");
		});
	});
});
