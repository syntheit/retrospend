/**
 * /api/v1/webhooks on Postgres, with a real HTTP receiver on loopback:
 * CRUD, the one-time secret, signed delivery, retries with backoff,
 * switching a failing webhook off, the test delivery, and the private
 * target block at create and again at delivery. Requests go through the
 * same handler the Next route uses.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { contract } from "@retrospend/api-contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createUserScopedDb } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import { getAppSettings, updateAppSettings } from "~/server/services/settings";
import {
	encryptSecret,
	verifyWebhookSignature,
} from "~/server/services/webhooks/secret";
import * as service from "~/server/services/webhooks/service";
import {
	processDueDeliveries,
	runWebhookWorker,
} from "~/server/services/webhooks/worker";
import {
	adminDb,
	asKey,
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

type Hook = {
	id: string;
	name: string;
	url: string;
	eventTypes: string[];
	enabled: boolean;
	secretStart: string;
	disabledReason: string | null;
	consecutiveFailures: number;
};
type Created = { webhook: Hook; secret: string };
type Delivery = {
	id: string;
	status: "pending" | "succeeded" | "failed";
	attempts: number;
	nextAttemptAt: string | null;
	lastStatusCode: number | null;
	lastError: string | null;
	eventType: string;
};
type Page<T> = { items: T[]; nextCursor: string | null };
type Received = { headers: IncomingHttpHeaders; body: string };

const MINUTE = 60_000;

describe("/api/v1/webhooks", () => {
	let alice: string;
	let bob: string;
	let asAlice: Record<string, string>;
	let asBob: Record<string, string>;
	let server: Server;
	let url: string;
	let received: Received[] = [];
	let respondWith = 204;
	let beforeRespond: (() => Promise<void>) | null = null;
	let wasPrivateAllowed = false;

	beforeAll(async () => {
		alice = (await createTestUser()).user.id;
		bob = (await createTestUser()).user.id;
		asAlice = await asMobile(alice);
		asBob = await asMobile(bob);
		wasPrivateAllowed = (await getAppSettings()).webhooksAllowPrivateTargets;
		await updateAppSettings({ webhooksAllowPrivateTargets: true });
		server = createServer((req, res) => {
			const chunks: Buffer[] = [];
			req.on("data", (c: Buffer) => chunks.push(c));
			req.on("end", async () => {
				received.push({
					headers: req.headers,
					body: Buffer.concat(chunks).toString("utf8"),
				});
				await beforeRespond?.();
				res.statusCode = respondWith;
				res.end("a body the log must never keep");
			});
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
	});

	afterAll(async () => {
		await updateAppSettings({ webhooksAllowPrivateTargets: wasPrivateAllowed });
		await new Promise<void>((r) => server.close(() => r()));
	});

	const create = async (
		headers: Record<string, string>,
		body: Record<string, unknown> = {},
	) =>
		expectBody<Created>(
			await call("/webhooks", {
				method: "POST",
				headers,
				idempotent: true,
				body: { name: "Ledger sync", url, ...body },
			}),
			contract.webhooks.create,
			201,
		);

	/** A user with a webhook, so one test's deliveries never mix with another's. */
	const fresh = async (body: Record<string, unknown> = {}) => {
		const id = (await createTestUser()).user.id;
		const headers = await asMobile(id);
		return { id, headers, ...(await create(headers, body)) };
	};

	const addCategory = (headers: Record<string, string>, name = "Hidden name") =>
		call("/categories", {
			method: "POST",
			headers,
			idempotent: true,
			body: { name: `${name} ${randomUUID().slice(0, 4)}`, color: "teal" },
		});

	const deliveriesOf = (webhookId: string) =>
		adminDb.webhookDelivery.findMany({
			where: { webhookId },
			orderBy: { createdAt: "asc" },
		});

	/**
	 * Runs the worker until `done`. The outbox only releases an event once
	 * every older open transaction on the shared Postgres server has ended.
	 */
	async function sweepUntil(
		done: () => Promise<boolean>,
		options: Parameters<typeof runWebhookWorker>[0] = {},
	) {
		for (let i = 0; i < 60; i++) {
			await runWebhookWorker(options);
			if (await done()) return;
			await new Promise((r) => setTimeout(r, 100));
		}
		throw new Error("the worker did not get there");
	}

	describe("CRUD", () => {
		it("creates with a secret shown once, lists without it, and stores it encrypted", async () => {
			const { webhook, secret } = await create(asAlice, {
				eventTypes: ["expense.*", "payment.recorded"],
			});
			expect(secret).toMatch(/^whsec_/);
			expect(webhook).toMatchObject({
				name: "Ledger sync",
				url,
				eventTypes: ["expense.*", "payment.recorded"],
				enabled: true,
				secretStart: secret.slice(0, 10),
				consecutiveFailures: 0,
			});

			const list = await expectBody<Page<Hook>>(
				await call("/webhooks", { headers: asAlice }),
				contract.webhooks.list,
			);
			expect(list.items.some((w) => w.id === webhook.id)).toBe(true);
			expect(JSON.stringify(list)).not.toContain(secret);

			const row = await adminDb.webhook.findUniqueOrThrow({
				where: { id: webhook.id },
			});
			expect(row.secretCipher).not.toContain(secret.slice(10));
		});

		it("does not store the secret in the idempotency record", async () => {
			const key = randomUUID();
			const send = () =>
				call("/webhooks", {
					method: "POST",
					headers: asAlice,
					idempotent: key,
					body: { name: "Once", url },
				});
			expect((await send()).status).toBe(201);
			await expectProblem(await send(), 409, "idempotency_replay_unavailable");
		});

		it("keeps webhooks private to their owner", async () => {
			const { webhook } = await create(asAlice);
			await expectProblem(
				await call(`/webhooks/${webhook.id}`, { headers: asBob }),
				404,
				"not_found",
			);
			await expectProblem(
				await call(`/webhooks/${webhook.id}`, {
					method: "DELETE",
					headers: asBob,
					idempotent: true,
				}),
				404,
				"not_found",
			);
			const bobs = await expectBody<Page<Hook>>(
				await call("/webhooks", { headers: asBob }),
				contract.webhooks.list,
			);
			expect(bobs.items.some((w) => w.id === webhook.id)).toBe(false);
		});

		it("updates, turns off and on, and deletes with its log", async () => {
			const { webhook } = await create(asAlice);
			const patch = (data: unknown) =>
				call(`/webhooks/${webhook.id}`, {
					method: "PATCH",
					headers: asAlice,
					idempotent: true,
					body: data,
				});
			const renamed = await expectBody<Hook>(
				await patch({ name: "Renamed", eventTypes: ["income.*"] }),
				contract.webhooks.update,
			);
			expect(renamed).toMatchObject({
				name: "Renamed",
				eventTypes: ["income.*"],
			});

			const off = await expectBody<Hook>(
				await patch({ enabled: false }),
				contract.webhooks.update,
			);
			expect(off).toMatchObject({ enabled: false, disabledReason: "manual" });
			const on = await expectBody<Hook>(
				await patch({ enabled: true }),
				contract.webhooks.update,
			);
			expect(on).toMatchObject({ enabled: true, disabledReason: null });

			const tested = await call(`/webhooks/${webhook.id}/test`, {
				method: "POST",
				headers: asAlice,
				idempotent: true,
			});
			expect(tested.status).toBe(200);
			expect(await deliveriesOf(webhook.id)).toHaveLength(1);
			const del = await call(`/webhooks/${webhook.id}`, {
				method: "DELETE",
				headers: asAlice,
				idempotent: true,
			});
			expect(del.status).toBe(200);
			expect(await deliveriesOf(webhook.id)).toHaveLength(0);
			await expectProblem(
				await call(`/webhooks/${webhook.id}`, { headers: asAlice }),
				404,
				"not_found",
			);
		});

		it("refuses a malformed event filter and more than ten webhooks", async () => {
			const bad = await call("/webhooks", {
				method: "POST",
				headers: asAlice,
				idempotent: true,
				body: { name: "x", url, eventTypes: ["Expense Created"] },
			});
			await expectProblem(bad, 400, "validation_failed");

			const { headers } = await fresh();
			for (let i = 0; i < 9; i++) await create(headers);
			await expectProblem(
				await call("/webhooks", {
					method: "POST",
					headers,
					idempotent: true,
					body: { name: "eleventh", url },
				}),
				409,
				"conflict",
			);
		});

		it("needs write:settings to change and read to look", async () => {
			const readOnly = await asKey(alice, ["read"]);
			await expectProblem(
				await call("/webhooks", {
					method: "POST",
					headers: readOnly,
					idempotent: true,
					body: { name: "x", url },
				}),
				403,
				"missing_scope",
			);
			const { webhook } = await create(asAlice, {
				url: `${url}?token=abc123&x=1`,
			});
			const seen = await expectBody<Page<Hook>>(
				await call("/webhooks", { headers: readOnly }),
				contract.webhooks.list,
			);
			const origin = new URL(url).origin;
			expect(seen.items.find((w) => w.id === webhook.id)?.url).toBe(
				`${origin}/***`,
			);
			const one = await call(`/webhooks/${webhook.id}`, { headers: readOnly });
			expect(JSON.stringify(await one.json())).not.toContain("abc123");
			const full = await expectBody<Hook>(
				await call(`/webhooks/${webhook.id}`, { headers: asAlice }),
				contract.webhooks.get,
			);
			expect(full.url).toContain("token=abc123");
			const writeOnly = await asKey(alice, ["write:expenses"]);
			await expectProblem(
				await call("/webhooks", { headers: writeOnly }),
				403,
				"missing_scope",
			);
			await expectProblem(await call("/webhooks"), 401, "unauthenticated");
		});

		it("gives the app role no way to write the delivery log", async () => {
			const { id, webhook } = await fresh();
			await expect(
				userTransaction(adminDb, id, (tx) =>
					tx.webhookDelivery.create({
						data: {
							webhookId: webhook.id,
							userId: id,
							eventType: "x.y",
						},
					}),
				),
			).rejects.toThrow();
		});
	});

	describe("refusing private targets", () => {
		it("refuses loopback, private, metadata and IPv6 loopback URLs", async () => {
			await updateAppSettings({ webhooksAllowPrivateTargets: false });
			try {
				for (const target of [
					"https://127.0.0.1/hook",
					"https://10.1.2.3/hook",
					"https://169.254.169.254/latest/meta-data/",
					"https://[::1]/hook",
					"http://hooks.example.com/hook",
				]) {
					const res = await call("/webhooks", {
						method: "POST",
						headers: asAlice,
						idempotent: true,
						body: { name: "x", url: target },
					});
					await expectProblem(res, 400, "validation_failed");
				}
				expect(
					await adminDb.webhook.count({
						where: { userId: alice, url: { contains: "169.254" } },
					}),
				).toBe(0);
			} finally {
				await updateAppSettings({ webhooksAllowPrivateTargets: true });
			}
		});

		it("refuses a host name that resolves to a private address, at create and on a new URL", async () => {
			const caller = {
				db: createUserScopedDb(alice),
				principal: { userId: alice } as never,
			};
			const policy = {
				allowPrivate: false,
				resolve: async () => ["192.168.0.12"],
			};
			await expect(
				service.createWebhook(
					caller,
					{ name: "x", url: "https://innocent.example.com/in", eventTypes: [] },
					policy,
				),
			).rejects.toMatchObject({ code: "blocked_target" });

			const publicName = {
				...policy,
				resolve: async () => ["93.184.216.34"],
			};
			const ok = await service.createWebhook(
				caller,
				{ name: "x", url: "https://public.example.com/in", eventTypes: [] },
				publicName,
			);
			await expect(
				service.updateWebhook(
					caller,
					{ id: ok.webhook.id, url: "https://rebind.example.com/in" },
					policy,
				),
			).rejects.toMatchObject({ code: "blocked_target" });
		});

		it("checks again at every delivery, after DNS", async () => {
			received = [];
			const user = (await createTestUser()).user.id;
			const hook = await adminDb.webhook.create({
				data: {
					userId: user,
					name: "rebind",
					url: "https://rebind.example.com/in",
					secretCipher: encryptSecret("whsec_x"),
					secretStart: "whsec_x",
				},
			});
			const event = await adminDb.apiEvent.create({
				data: { userId: user, type: "expense.created", payload: {} },
			});
			await adminDb.webhookDelivery.create({
				data: {
					webhookId: hook.id,
					userId: user,
					eventId: event.id,
					eventType: event.type,
					nextAttemptAt: new Date(0),
				},
			});
			// It resolved public when the webhook was made; now it answers private.
			await processDueDeliveries({
				allowPrivate: false,
				resolve: async () => ["10.0.0.1"],
			});
			const [row] = await deliveriesOf(hook.id);
			expect(row).toMatchObject({
				status: "FAILED",
				lastError: "blocked_target",
				nextAttemptAt: null,
			});
			expect(
				await adminDb.webhook.findUniqueOrThrow({ where: { id: hook.id } }),
			).toMatchObject({ enabled: false, disabledReason: "blocked_target" });
			expect(received).toHaveLength(0);
		});
	});

	describe("delivery", () => {
		it("posts a signed event with ids and amounts and logs the attempt", async () => {
			received = [];
			respondWith = 204;
			const { headers, id, webhook, secret } = await fresh({
				eventTypes: ["category.*"],
			});
			const res = await addCategory(headers, "Private clinic visits");
			const category = await expectBody<{ id: string }>(
				res,
				contract.categories.create,
				201,
			);
			await sweepUntil(async () => received.length === 1);

			const [hit] = received;
			expect(hit?.headers["content-type"]).toBe("application/json");
			expect(hit?.headers["retrospend-event-type"]).toBe("category.created");
			const signature = String(hit?.headers["retrospend-signature"]);
			expect(verifyWebhookSignature(secret, signature, hit?.body ?? "")).toBe(
				true,
			);
			expect(
				verifyWebhookSignature("whsec_wrong", signature, hit?.body ?? ""),
			).toBe(false);
			const event = JSON.parse(hit?.body ?? "{}");
			expect(event).toMatchObject({
				type: "category.created",
				actorUserId: id,
				entity: { type: "category", id: category.id },
			});
			expect(hit?.body).not.toMatch(/Private|clinic/);
			expect(hit?.headers["retrospend-event-id"]).toBe(event.id);

			const log = await expectBody<Page<Delivery>>(
				await call(`/webhooks/${webhook.id}/deliveries`, { headers }),
				contract.webhooks.deliveries,
			);
			expect(log.items).toHaveLength(1);
			expect(log.items[0]).toMatchObject({
				status: "succeeded",
				attempts: 1,
				lastStatusCode: 204,
				lastError: null,
				eventType: "category.created",
			});
			// The answer body is never kept.
			expect(JSON.stringify(log)).not.toContain("a body the log");
		});

		it("sends only the types the webhook asked for, and never its own changes", async () => {
			received = [];
			respondWith = 204;
			const { headers, webhook } = await fresh({ eventTypes: ["expense.*"] });
			await addCategory(headers);
			await call(`/webhooks/${webhook.id}`, {
				method: "PATCH",
				headers,
				idempotent: true,
				body: { name: "Renamed" },
			});
			const all = await fresh();
			await call(`/webhooks/${all.webhook.id}`, {
				method: "PATCH",
				headers: all.headers,
				idempotent: true,
				body: { name: "Renamed too" },
			});
			await sweepUntil(
				async () =>
					(await adminDb.apiEvent.count({
						where: { fannedOutAt: null },
					})) === 0,
			);
			expect(await deliveriesOf(webhook.id)).toHaveLength(0);
			expect(await deliveriesOf(all.webhook.id)).toHaveLength(0);
			expect(received).toHaveLength(0);
		});

		it("does not send events from before the webhook existed", async () => {
			received = [];
			const id = (await createTestUser()).user.id;
			const headers = await asMobile(id);
			await addCategory(headers);
			await new Promise((r) => setTimeout(r, 20));
			const { webhook } = await create(headers);
			await sweepUntil(
				async () =>
					(await adminDb.apiEvent.count({ where: { fannedOutAt: null } })) ===
					0,
			);
			expect(await deliveriesOf(webhook.id)).toHaveLength(0);
		});

		it("retries with doubling waits, then succeeds and clears the failures", async () => {
			received = [];
			respondWith = 500;
			const { headers, webhook } = await fresh();
			await addCategory(headers);
			const t0 = Date.now() + 10_000;
			const at = (ms: number) => ({ now: new Date(t0 + ms) });
			const delivery = async () => (await deliveriesOf(webhook.id))[0];

			await sweepUntil(async () => received.length === 1, at(0));
			expect(await delivery()).toMatchObject({
				status: "PENDING",
				attempts: 1,
				lastStatusCode: 500,
				lastError: "http_error",
			});
			expect((await delivery())?.nextAttemptAt?.getTime()).toBe(t0 + MINUTE);

			// Not due yet: nothing is sent.
			await processDueDeliveries(at(MINUTE - 1000));
			expect(received).toHaveLength(1);

			await processDueDeliveries(at(MINUTE + 1));
			expect(received).toHaveLength(2);
			expect((await delivery())?.attempts).toBe(2);
			expect((await delivery())?.nextAttemptAt?.getTime()).toBe(
				t0 + MINUTE + 1 + 2 * MINUTE,
			);
			// Failed attempts that will be retried do not count against the webhook.
			expect(
				(await adminDb.webhook.findUniqueOrThrow({ where: { id: webhook.id } }))
					.consecutiveFailures,
			).toBe(0);

			respondWith = 200;
			await processDueDeliveries(at(10 * MINUTE));
			expect(await delivery()).toMatchObject({
				status: "SUCCEEDED",
				attempts: 3,
				nextAttemptAt: null,
				lastError: null,
			});
			expect(
				(await adminDb.webhook.findUniqueOrThrow({ where: { id: webhook.id } }))
					.consecutiveFailures,
			).toBe(0);
		});

		it("gives up after the last attempt", async () => {
			received = [];
			respondWith = 503;
			const { headers, webhook } = await fresh();
			await addCategory(headers);
			await sweepUntil(
				async () => (await deliveriesOf(webhook.id)).length === 1,
				{ now: new Date(Date.now() + 10_000) },
			);
			await adminDb.webhookDelivery.updateMany({
				where: { webhookId: webhook.id },
				data: { attempts: 9, nextAttemptAt: new Date(0) },
			});
			await processDueDeliveries({ now: new Date(Date.now() + 10_000) });
			expect((await deliveriesOf(webhook.id))[0]).toMatchObject({
				status: "FAILED",
				attempts: 10,
				nextAttemptAt: null,
				lastError: "http_error",
			});
			expect(
				(await adminDb.webhook.findUniqueOrThrow({ where: { id: webhook.id } }))
					.consecutiveFailures,
			).toBe(1);
		});

		it("survives a short outage of the receiver: many failed first attempts, none lost", async () => {
			received = [];
			respondWith = 503;
			const { id, webhook } = await fresh();
			await adminDb.apiEvent.createMany({
				data: Array.from({ length: 25 }, () => ({
					userId: id,
					type: "expense.created",
					payload: {},
				})),
			});
			const t0 = Date.now() + 10_000;
			await sweepUntil(
				async () => (await deliveriesOf(webhook.id)).length === 25,
				{ now: new Date(t0) },
			);
			const failed = await deliveriesOf(webhook.id);
			expect(
				failed.every((d) => d.attempts === 1 && d.status === "PENDING"),
			).toBe(true);
			expect(
				await adminDb.webhook.findUniqueOrThrow({ where: { id: webhook.id } }),
			).toMatchObject({ enabled: true, consecutiveFailures: 0 });

			// Two minutes later the receiver is back and every delivery goes out.
			respondWith = 200;
			await processDueDeliveries({ now: new Date(t0 + 2 * MINUTE + 1) });
			await processDueDeliveries({ now: new Date(t0 + 2 * MINUTE + 1) });
			const done = await deliveriesOf(webhook.id);
			expect(done.every((d) => d.status === "SUCCEEDED")).toBe(true);
			expect(
				await adminDb.webhook.findUniqueOrThrow({ where: { id: webhook.id } }),
			).toMatchObject({ enabled: true, consecutiveFailures: 0 });
		});

		it("fails a delivery whose secret cannot be read, and counts the attempt", async () => {
			received = [];
			respondWith = 204;
			const { headers, webhook } = await fresh();
			await adminDb.webhook.update({
				where: { id: webhook.id },
				data: { secretCipher: "v1.AAAA.AAAA.AAAA" },
			});
			await addCategory(headers);
			await sweepUntil(
				async () => (await deliveriesOf(webhook.id)).length === 1,
				{ now: new Date(Date.now() + 10_000) },
			);
			expect((await deliveriesOf(webhook.id))[0]).toMatchObject({
				status: "PENDING",
				attempts: 1,
				lastError: "secret_unreadable",
			});
			expect(received).toHaveLength(0);
			const tested = await expectBody<Delivery>(
				await call(`/webhooks/${webhook.id}/test`, {
					method: "POST",
					headers,
					idempotent: true,
				}),
				contract.webhooks.test,
			);
			expect(tested).toMatchObject({
				status: "failed",
				lastError: "secret_unreadable",
			});
		});

		it("does not overwrite a delivery another worker took over", async () => {
			received = [];
			respondWith = 204;
			const { headers, webhook } = await fresh();
			await addCategory(headers);
			await sweepUntil(
				async () => (await deliveriesOf(webhook.id)).length === 1,
				{ now: new Date(Date.now() - 3_600_000) },
			);
			const [row] = await deliveriesOf(webhook.id);
			const takenOver = new Date(Date.now() + 99 * MINUTE);
			// While the send is in flight, the lease expires and a second worker claims it.
			beforeRespond = async () => {
				await adminDb.webhookDelivery.update({
					where: { id: row?.id },
					data: { nextAttemptAt: takenOver },
				});
			};
			try {
				await adminDb.webhookDelivery.update({
					where: { id: row?.id },
					data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(0) },
				});
				await processDueDeliveries({ now: new Date(Date.now() + 10_000) });
			} finally {
				beforeRespond = null;
			}
			expect((await deliveriesOf(webhook.id))[0]).toMatchObject({
				status: "PENDING",
				attempts: 0,
				nextAttemptAt: takenOver,
			});
		});

		it("switches a webhook off after five deliveries ran out of retries, and stops its queue", async () => {
			received = [];
			respondWith = 500;
			const { headers, webhook } = await fresh();
			await adminDb.webhook.update({
				where: { id: webhook.id },
				data: { consecutiveFailures: 4 },
			});
			await addCategory(headers);
			await addCategory(headers);
			const now = () => ({ now: new Date(Date.now() + 10_000) });
			await sweepUntil(
				async () => (await deliveriesOf(webhook.id)).length === 2,
				now(),
			);
			expect(
				await adminDb.webhook.findUniqueOrThrow({ where: { id: webhook.id } }),
			).toMatchObject({ enabled: true, consecutiveFailures: 4 });

			// One delivery is on its last attempt; the other is still retrying.
			const [last] = await deliveriesOf(webhook.id);
			await adminDb.webhookDelivery.updateMany({
				where: { webhookId: webhook.id },
				data: { nextAttemptAt: new Date(0) },
			});
			await adminDb.webhookDelivery.update({
				where: { id: last?.id },
				data: { attempts: 9 },
			});
			await processDueDeliveries(now());
			expect(
				await adminDb.webhook.findUniqueOrThrow({ where: { id: webhook.id } }),
			).toMatchObject({ enabled: false, disabledReason: "too_many_failures" });
			expect(
				(await deliveriesOf(webhook.id)).every((d) => d.status === "FAILED"),
			).toBe(true);

			// Nothing more is sent.
			const sent = received.length;
			await processDueDeliveries({ now: new Date(Date.now() + 3_600_000) });
			expect(received.length).toBe(sent);

			const shown = await expectBody<Hook>(
				await call(`/webhooks/${webhook.id}`, { headers }),
				contract.webhooks.get,
			);
			expect(shown).toMatchObject({
				enabled: false,
				disabledReason: "too_many_failures",
			});

			respondWith = 204;
			const back = await expectBody<Hook>(
				await call(`/webhooks/${webhook.id}`, {
					method: "PATCH",
					headers,
					idempotent: true,
					body: { enabled: true },
				}),
				contract.webhooks.update,
			);
			expect(back).toMatchObject({
				enabled: true,
				disabledReason: null,
				consecutiveFailures: 0,
			});
		});
	});

	describe("test delivery and secret rotation", () => {
		it("sends a signed webhook.test now, logs it and does not retry or count it", async () => {
			received = [];
			respondWith = 204;
			const { headers, webhook, secret } = await fresh();
			const ok = await expectBody<Delivery>(
				await call(`/webhooks/${webhook.id}/test`, {
					method: "POST",
					headers,
					idempotent: true,
				}),
				contract.webhooks.test,
			);
			expect(ok).toMatchObject({
				status: "succeeded",
				attempts: 1,
				eventType: "webhook.test",
				lastStatusCode: 204,
			});
			expect(received).toHaveLength(1);
			expect(
				verifyWebhookSignature(
					secret,
					String(received[0]?.headers["retrospend-signature"]),
					received[0]?.body ?? "",
				),
			).toBe(true);
			expect(JSON.parse(received[0]?.body ?? "{}").type).toBe("webhook.test");

			respondWith = 500;
			const bad = await expectBody<Delivery>(
				await call(`/webhooks/${webhook.id}/test`, {
					method: "POST",
					headers,
					idempotent: true,
				}),
				contract.webhooks.test,
			);
			expect(bad).toMatchObject({
				status: "failed",
				nextAttemptAt: null,
				lastError: "http_error",
				lastStatusCode: 500,
			});
			expect(
				(await adminDb.webhook.findUniqueOrThrow({ where: { id: webhook.id } }))
					.consecutiveFailures,
			).toBe(0);
			respondWith = 204;
		});

		it("rotates the secret: the old one stops verifying, the new one verifies", async () => {
			received = [];
			respondWith = 204;
			const { headers, webhook, secret } = await fresh();
			const rotated = await expectBody<Created>(
				await call(`/webhooks/${webhook.id}/rotate-secret`, {
					method: "POST",
					headers,
					idempotent: true,
				}),
				contract.webhooks.rotateSecret,
			);
			expect(rotated.secret).not.toBe(secret);
			expect(rotated.webhook.secretStart).toBe(rotated.secret.slice(0, 10));

			await call(`/webhooks/${webhook.id}/test`, {
				method: "POST",
				headers,
				idempotent: true,
			});
			const header = String(received[0]?.headers["retrospend-signature"]);
			const body = received[0]?.body ?? "";
			expect(verifyWebhookSignature(rotated.secret, header, body)).toBe(true);
			expect(verifyWebhookSignature(secret, header, body)).toBe(false);
			expect(rotated.webhook.previousSecretExpiresAt).toBeNull();
			const row = await adminDb.webhook.findUniqueOrThrow({
				where: { id: webhook.id },
			});
			expect(row.previousSecretCipher).toBeNull();
		});

		describe("a grace period for the old secret", () => {
			const rotate = (
				headers: Record<string, string>,
				id: string,
				graceSeconds?: number,
			) =>
				call(`/webhooks/${id}/rotate-secret`, {
					method: "POST",
					headers,
					body: graceSeconds === undefined ? undefined : { graceSeconds },
					idempotent: true,
				});
			const sendTest = async (
				headers: Record<string, string>,
				id: string,
			) => {
				received = [];
				await call(`/webhooks/${id}/test`, {
					method: "POST",
					headers,
					idempotent: true,
				});
				return {
					header: String(received[0]?.headers["retrospend-signature"]),
					body: received[0]?.body ?? "",
				};
			};

			it("signs with both secrets until it ends, then only the new one", async () => {
				respondWith = 204;
				const { headers, webhook, secret } = await fresh();
				const rotated = await expectBody<Created>(
					await rotate(headers, webhook.id, 3600),
					contract.webhooks.rotateSecret,
				);
				expect(rotated.webhook.previousSecretExpiresAt).not.toBeNull();
				const ends = new Date(
					rotated.webhook.previousSecretExpiresAt as string,
				).getTime();
				expect(Math.abs(ends - (Date.now() + 3_600_000))).toBeLessThan(10_000);

				const both = await sendTest(headers, webhook.id);
				expect(both.header.match(/v1=/g)).toHaveLength(2);
				expect(verifyWebhookSignature(rotated.secret, both.header, both.body)).toBe(true);
				expect(verifyWebhookSignature(secret, both.header, both.body)).toBe(true);

				// The grace period runs out: the old secret stops signing.
				await adminDb.webhook.update({
					where: { id: webhook.id },
					data: { previousSecretExpiresAt: new Date(Date.now() - 1000) },
				});
				const after = await sendTest(headers, webhook.id);
				expect(after.header.match(/v1=/g)).toHaveLength(1);
				expect(verifyWebhookSignature(rotated.secret, after.header, after.body)).toBe(true);
				expect(verifyWebhookSignature(secret, after.header, after.body)).toBe(false);
				const read = await expectBody<{ previousSecretExpiresAt: string | null }>(
					await call(`/webhooks/${webhook.id}`, { headers }),
					contract.webhooks.get,
				);
				expect(read.previousSecretExpiresAt).toBeNull();
			});

			it("keeps only one old secret: rotating again drops the older one", async () => {
				respondWith = 204;
				const { headers, webhook, secret: first } = await fresh();
				const second = await expectBody<Created>(
					await rotate(headers, webhook.id, 3600),
					contract.webhooks.rotateSecret,
				);
				const third = await expectBody<Created>(
					await rotate(headers, webhook.id, 3600),
					contract.webhooks.rotateSecret,
				);
				const sent = await sendTest(headers, webhook.id);
				expect(verifyWebhookSignature(third.secret, sent.header, sent.body)).toBe(true);
				expect(verifyWebhookSignature(second.secret, sent.header, sent.body)).toBe(true);
				expect(verifyWebhookSignature(first, sent.header, sent.body)).toBe(false);
			});

			it("is over at once when a plain rotation follows a graceful one", async () => {
				respondWith = 204;
				const { headers, webhook, secret } = await fresh();
				await rotate(headers, webhook.id, 3600);
				const plain = await expectBody<Created>(
					await rotate(headers, webhook.id),
					contract.webhooks.rotateSecret,
				);
				expect(plain.webhook.previousSecretExpiresAt).toBeNull();
				const sent = await sendTest(headers, webhook.id);
				expect(sent.header.match(/v1=/g)).toHaveLength(1);
				expect(verifyWebhookSignature(secret, sent.header, sent.body)).toBe(false);
			});

			it("refuses a grace period over seven days or below zero", async () => {
				const { headers, webhook } = await fresh();
				for (const seconds of [7 * 86400 + 1, -1, 1.5])
					expect((await rotate(headers, webhook.id, seconds)).status).toBe(400);
			});
		});
	});
});
