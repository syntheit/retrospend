/**
 * A webhook switching itself off after too many failures must not rewrite a
 * send that is already on the wire. Its other pending deliveries stay
 * pending: they fail when they come due while it is off, or go out if the
 * owner turns it back on first.
 */
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { AUTO_DISABLE_AFTER, MAX_ATTEMPTS } from "./schedule";
import { encryptSecret } from "./secret";
import { processDueDeliveries } from "./worker";

const NOW = new Date("2026-10-26T15:00:00Z");
const LATER = new Date("2026-10-26T16:00:00Z");

describe("webhook auto-disable", () => {
	let server: Server;
	let port: number;
	let hits: string[] = [];
	/** Delivery ids the receiver fails with a 500. */
	let failing = new Set<string>();
	/** Delivery ids the receiver holds until their webhook is off. */
	let holding = new Set<string>();

	async function webhookOff(deliveryId: string) {
		const row = await adminDb.webhookDelivery.findUniqueOrThrow({
			where: { id: deliveryId },
			include: { webhook: true },
		});
		return !row.webhook.enabled;
	}

	beforeAll(async () => {
		server = createServer((req, res) => {
			const id = String(req.headers["retrospend-delivery-id"]);
			hits.push(id);
			void (async () => {
				if (holding.has(id)) {
					for (let n = 0; n < 100 && !(await webhookOff(id)); n++)
						await new Promise((r) => setTimeout(r, 20));
					// Let the switch-off finish whatever follows it.
					await new Promise((r) => setTimeout(r, 250));
				}
				res.statusCode = failing.has(id) ? 500 : 204;
				res.end();
			})();
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		port = (server.address() as AddressInfo).port;
	});

	afterAll(async () => {
		await adminDb.webhookDelivery.deleteMany({});
		await new Promise<void>((r) => server.close(() => r()));
	});

	beforeEach(async () => {
		// The worker takes any due delivery, other files' leftovers included.
		await adminDb.webhookDelivery.deleteMany({});
		hits = [];
		failing = new Set();
		holding = new Set();
	});

	const sweep = (now: Date) =>
		processDueDeliveries({
			now,
			allowPrivate: true,
			resolve: async () => ["127.0.0.1"],
		});

	/** A webhook one terminal failure away from switching itself off. */
	async function hook() {
		const { user } = await createTestUser();
		const webhook = await adminDb.webhook.create({
			data: {
				id: randomUUID(),
				userId: user.id,
				name: "disable",
				url: `http://disable.site.test:${port}/hook`,
				eventTypes: [],
				secretCipher: encryptSecret("whsec_test"),
				secretStart: "whsec_test",
				consecutiveFailures: AUTO_DISABLE_AFTER - 1,
			},
		});
		return { userId: user.id, webhookId: webhook.id };
	}

	async function delivery(
		target: { userId: string; webhookId: string },
		nextAttemptAt: Date,
		attempts = 0,
	) {
		const event = await adminDb.apiEvent.create({
			data: {
				userId: target.userId,
				actorUserId: target.userId,
				type: "expense.created",
				payload: { ids: {}, amounts: [], truncated: false },
				fannedOutAt: NOW,
			},
		});
		const row = await adminDb.webhookDelivery.create({
			data: {
				webhookId: target.webhookId,
				userId: target.userId,
				eventId: event.id,
				eventType: "expense.created",
				nextAttemptAt,
				attempts,
			},
		});
		return row.id;
	}

	const read = (id: string) =>
		adminDb.webhookDelivery.findUniqueOrThrow({ where: { id } });

	/** Switches the webhook off: its last-try delivery fails while another is in flight. */
	async function switchOffMidSend() {
		const target = await hook();
		const inFlight = await delivery(target, NOW);
		const lastTry = await delivery(target, NOW, MAX_ATTEMPTS - 1);
		const later = await delivery(target, LATER);
		holding.add(inFlight);
		failing.add(lastTry);

		expect(await sweep(NOW)).toBe(2);

		const webhook = await adminDb.webhook.findUniqueOrThrow({
			where: { id: target.webhookId },
		});
		expect(webhook.enabled).toBe(false);
		expect(webhook.disabledReason).toBe("too_many_failures");
		expect((await read(lastTry)).status).toBe("FAILED");
		return { target, inFlight, later };
	}

	it("records a send that was in flight when the webhook switched off as delivered", async () => {
		const { inFlight } = await switchOffMidSend();

		const row = await read(inFlight);
		expect(row.status).toBe("SUCCEEDED");
		expect(row.deliveredAt).toEqual(NOW);
		expect(row.lastStatusCode).toBe(204);
		expect(row.lastError).toBeNull();
	});

	it("keeps the other deliveries pending, then fails them when due while it is off", async () => {
		const { later } = await switchOffMidSend();
		expect(await read(later)).toMatchObject({
			status: "PENDING",
			nextAttemptAt: LATER,
		});
		hits = [];

		await sweep(LATER);

		expect(hits).toEqual([]);
		expect(await read(later)).toMatchObject({
			status: "FAILED",
			nextAttemptAt: null,
			lastError: "webhook_disabled",
		});
	});

	it("delivers the pending ones if the webhook is back on before they are due", async () => {
		const { target, later } = await switchOffMidSend();
		await adminDb.webhook.update({
			where: { id: target.webhookId },
			data: {
				enabled: true,
				consecutiveFailures: 0,
				disabledAt: null,
				disabledReason: null,
			},
		});
		hits = [];

		await sweep(LATER);

		expect(hits).toEqual([later]);
		expect(await read(later)).toMatchObject({
			status: "SUCCEEDED",
			deliveredAt: LATER,
		});
	});
});
